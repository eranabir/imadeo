import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { toBytes } from '../../common/bytes';
import { SourceType } from '../../db';
import { JOB, QUEUE, type AssetJobData } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { MachineLearningService } from '../../infra/ml/ml.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FaceClusteringService } from './face-clustering.service';
import { PersonService } from './person.service';

/**
 * Detects faces in one asset and groups them.
 *
 * Concurrency is low on purpose: the model is CPU-bound and the ML service runs
 * a single worker, so queuing more requests than it can serve only adds latency.
 */
@Processor(QUEUE.FACE_DETECTION, { concurrency: 2 })
export class FaceDetectionProcessor extends WorkerHost {
  private readonly logger = new Logger(FaceDetectionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ml: MachineLearningService,
    private readonly clustering: FaceClusteringService,
    private readonly people: PersonService,
    private readonly jobs: JobService,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    const asset = await this.prisma.asset.findUnique({ where: { id: job.data.assetId } });
    if (!asset) return { skipped: 'asset gone' };

    // Videos would need frame sampling, which is a separate piece of work.
    if (asset.type !== 'IMAGE') return { skipped: 'not an image' };

    // Vault content is never sent to the ML service: the whole point of locking
    // something is that it stops flowing through the rest of the system.
    if (asset.visibility === 'LOCKED') return { skipped: 'locked' };

    const source = asset.previewPath ?? asset.originalPath;
    if (!source) return { skipped: 'no preview yet' };

    if (!(await this.ml.isReady())) {
      // Fail loudly so BullMQ retries with backoff rather than silently
      // marking the asset as processed.
      throw new Error('The machine-learning service is not ready');
    }

    const result = await this.ml.detectFaces(source);
    if (!result) throw new Error('Face detection returned no result');

    // Replace previous automatic detections; keep anything a person set by hand.
    await this.prisma.assetFace.deleteMany({
      where: { assetId: asset.id, sourceType: SourceType.MACHINE_LEARNING, isPinned: false },
    });

    for (const face of result.faces) {
      // The embedding column is `vector(512)`, which Prisma cannot express, so
      // the insert goes through raw SQL.
      await this.prisma.$executeRaw`
        INSERT INTO asset_faces (
          id, "assetId", "boundingBoxX1", "boundingBoxY1", "boundingBoxX2", "boundingBoxY2",
          "imageWidth", "imageHeight", score, embedding, "sourceType", "isPinned", "createdAt"
        ) VALUES (
          gen_random_uuid(), ${asset.id}::uuid,
          ${face.boundingBox.x1}, ${face.boundingBox.y1},
          ${face.boundingBox.x2}, ${face.boundingBox.y2},
          ${result.imageWidth}, ${result.imageHeight},
          ${face.score}, ${`[${face.embedding.join(',')}]`}::vector,
          'MACHINE_LEARNING', false, NOW()
        )
      `;
    }

    // Pets ride along in the same job rather than a queue of their own: the
    // preview is already picked and the ML service is already warm, and this
    // keeps "has this asset been analysed" a single flag.
    const petResult = await this.ml.detectPets(source);

    for (const pet of petResult?.pets ?? []) {
      await this.prisma.$executeRaw`
        INSERT INTO asset_faces (
          id, "assetId", "boundingBoxX1", "boundingBoxY1", "boundingBoxX2", "boundingBoxY2",
          "imageWidth", "imageHeight", score, embedding, kind, species,
          "sourceType", "isPinned", "createdAt"
        ) VALUES (
          gen_random_uuid(), ${asset.id}::uuid,
          ${pet.boundingBox.x1}, ${pet.boundingBox.y1},
          ${pet.boundingBox.x2}, ${pet.boundingBox.y2},
          ${petResult!.imageWidth}, ${petResult!.imageHeight},
          ${pet.score}, ${`[${pet.embedding.join(',')}]`}::vector,
          'PET'::"SubjectKind", ${pet.label},
          'MACHINE_LEARNING', false, NOW()
        )
      `;
    }

    const people = await this.clustering.assignFacesForAsset(asset.id, asset.ownerId);

    // A person's avatar is only regenerated when they do not have one, so a
    // deliberate choice is not overwritten by the next upload.
    for (const personId of people) {
      const person = await this.prisma.person.findUnique({
        where: { id: personId },
        select: { thumbnailPath: true },
      });
      if (!person?.thumbnailPath) await this.people.generateThumbnail(personId);
    }

    await this.prisma.assetJobStatus.upsert({
      where: { assetId: asset.id },
      create: { assetId: asset.id, facesRecognizedAt: new Date() },
      update: { facesRecognizedAt: new Date() },
    });

    if (result.faces.length > 0) {
      this.logger.debug(
        `${result.faces.length} face(s) in ${asset.originalFileName} across ${people.length} person(s)`,
      );
    }

    return {
      faces: result.faces.length,
      pets: petResult?.pets.length ?? 0,
      people: people.length,
    };
  }
}

/** Library-wide re-clustering, triggered from the admin surface. */
@Processor(QUEUE.FACE_CLUSTER, { concurrency: 1 })
export class FaceClusterProcessor extends WorkerHost {
  constructor(
    private readonly clustering: FaceClusteringService,
    private readonly people: PersonService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<{ userId: string }>) {
    const result = await this.clustering.recluster(job.data.userId);

    // Every surviving group needs an avatar again.
    const groups = await this.prisma.person.findMany({
      where: { ownerId: job.data.userId, thumbnailPath: '' },
      select: { id: true },
    });
    for (const group of groups) await this.people.generateThumbnail(group.id);

    return result;
  }
}
