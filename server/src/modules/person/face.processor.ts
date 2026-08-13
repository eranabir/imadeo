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

    if (!this.ml.faceRecognitionEnabled) return { skipped: 'face recognition disabled' };

    if (!(await this.ml.isFaceRecognitionReady())) {
      // Fail loudly so BullMQ retries with backoff rather than silently
      // marking the asset as processed.
      throw new Error('The machine-learning service is not ready');
    }

    // Run the pet detector first. Face detectors can mistake the front of a
    // dog or cat for a human face; a face centred inside a confirmed pet box
    // belongs to the pet, not the People tab.
    const petResult = await this.ml.detectPets(source);
    const result = await this.ml.detectFaces(source);
    if (!result) throw new Error('Face detection returned no result');
    const pets = [...(petResult?.pets ?? [])];
    const isInsidePet = (face: (typeof result.faces)[number]) =>
      pets.some((pet) => {
        const centerX = (face.boundingBox.x1 + face.boundingBox.x2) / 2;
        const centerY = (face.boundingBox.y1 + face.boundingBox.y2) / 2;
        return (
          centerX >= pet.boundingBox.x1 &&
          centerX <= pet.boundingBox.x2 &&
          centerY >= pet.boundingBox.y1 &&
          centerY <= pet.boundingBox.y2
        );
      });

    // A close cat can be too small or too occluded for the whole-animal
    // detector. In that specific case YuNet finds its face, so classify the
    // face crop before adding it to People.
    for (const face of result.faces) {
      if (isInsidePet(face)) continue;
      const recovered = await this.ml.classifyPetFaceCandidate(source, face.boundingBox);
      if (recovered) pets.push({ ...recovered, boundingBox: face.boundingBox });
    }

    const humanFaces = result.faces.filter((face) => !isInsidePet(face));

    // Replace previous automatic detections; keep anything a person set by hand.
    await this.prisma.assetFace.deleteMany({
      where: { assetId: asset.id, sourceType: SourceType.MACHINE_LEARNING, isPinned: false },
    });

    for (const face of humanFaces) {
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

    for (const pet of pets) {
      await this.prisma.$executeRaw`
        INSERT INTO asset_faces (
          id, "assetId", "boundingBoxX1", "boundingBoxY1", "boundingBoxX2", "boundingBoxY2",
          "imageWidth", "imageHeight", score, embedding, kind, species,
          "sourceType", "isPinned", "createdAt"
        ) VALUES (
          gen_random_uuid(), ${asset.id}::uuid,
          ${pet.boundingBox.x1}, ${pet.boundingBox.y1},
          ${pet.boundingBox.x2}, ${pet.boundingBox.y2},
          ${result.imageWidth}, ${result.imageHeight},
          ${pet.score}, ${`[${pet.embedding.join(',')}]`}::vector,
          'PET'::"SubjectKind", ${pet.label},
          'MACHINE_LEARNING', false, NOW()
        )
      `;
    }

    const people = await this.clustering.assignFacesForAsset(asset.id, asset.ownerId);

    // Automatic avatars follow the latest recognised photo, so a successful
    // upload is visible immediately. A cover deliberately chosen by the user
    // remains untouched.
    for (const personId of people) {
      const person = await this.prisma.person.findUnique({
        where: { id: personId },
        select: { thumbnailPath: true, thumbnailIsCustom: true },
      });
      if (!person?.thumbnailIsCustom) {
        await this.people.refreshThumbnail(personId);
      }
    }

    const recognisedAt = new Date();
    await this.prisma.assetJobStatus.upsert({
      where: { assetId: asset.id },
      create: {
        assetId: asset.id,
        facesRecognizedAt: recognisedAt,
        // Keep this null when the pet model is unavailable, so a later Scan
        // faces action fills in pets without re-uploading the whole library.
        ...(petResult ? { petsRecognizedAt: recognisedAt } : {}),
      },
      update: {
        facesRecognizedAt: recognisedAt,
        ...(petResult ? { petsRecognizedAt: recognisedAt } : {}),
      },
    });

    if (humanFaces.length > 0) {
      this.logger.debug(
        `${humanFaces.length} face(s) in ${asset.originalFileName} across ${people.length} person(s)`,
      );
    }

    return {
      faces: humanFaces.length,
      pets: pets.length,
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
