import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import type { AppConfig } from '../../config/configuration';
import { AssetType, SourceType, SubjectKind } from '../../db';
import { JOB, QUEUE, type AssetJobData } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { MediaService } from '../../infra/media/media.service';
import type { DetectedFace, DetectedPet } from '../../infra/ml/ml.service';
import { MachineLearningService } from '../../infra/ml/ml.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { FaceClusteringService } from './face-clustering.service';
import { SubjectService } from './subject.service';

interface RecognitionFrame {
  path: string;
  timecodeMs: number | null;
  temporary: boolean;
}

interface RecognitionDetection {
  kind: SubjectKind;
  species: string | null;
  boundingBox: { x1: number; y1: number; x2: number; y2: number };
  score: number;
  embedding: number[];
  imageWidth: number;
  imageHeight: number;
  sourceTimecodeMs: number | null;
}

interface VideoFaceQuality {
  minScore: number;
  minSharpness: number;
}

/** Rejects video-only false positives, partial faces and unusably blurry crops. */
export function isUsableVideoFace(
  face: Pick<DetectedFace, 'boundingBox' | 'score'>,
  imageWidth: number,
  imageHeight: number,
  sharpness: number,
  quality: VideoFaceQuality,
) {
  const { x1, y1, x2, y2 } = face.boundingBox;
  const marginX = imageWidth * 0.01;
  const marginY = imageHeight * 0.01;
  const minimumSize = Math.min(48, Math.min(imageWidth, imageHeight) * 0.08);

  return (
    face.score >= quality.minScore &&
    sharpness >= quality.minSharpness &&
    x2 - x1 >= minimumSize &&
    y2 - y1 >= minimumSize &&
    x1 > marginX &&
    y1 > marginY &&
    x2 < imageWidth - marginX &&
    y2 < imageHeight - marginY
  );
}

/** Evenly samples ordinary clips while keeping work bounded for hour-long videos. */
export function videoRecognitionTimestamps(
  durationSeconds: number,
  intervalSeconds: number,
  maxFrames: number,
) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];

  // Container duration commonly extends a fraction beyond the final decodable
  // video frame (especially HEVC in MOV). Seeking only 100ms from that value can
  // therefore produce zero frames; one second leaves a reliable decoding margin.
  const endMargin = durationSeconds <= 1 ? 0.1 : 1;
  const end = Math.max(0, durationSeconds - endMargin);
  const candidates = [Math.min(1, end)];
  for (let second = intervalSeconds; second < end; second += intervalSeconds) {
    candidates.push(second);
  }
  if (end - candidates[candidates.length - 1] >= intervalSeconds / 2) candidates.push(end);

  const unique = [...new Set(candidates.map((second) => Math.round(second * 100) / 100))];
  if (unique.length <= maxFrames) return unique;
  if (maxFrames <= 1) return [unique[0]];

  return Array.from({ length: maxFrames }, (_, index) => {
    const sourceIndex = Math.round((index * (unique.length - 1)) / (maxFrames - 1));
    return unique[sourceIndex];
  });
}

export function redundantVideoDetectionIds(
  detections: {
    id: string;
    personId: string | null;
    kind: SubjectKind;
    sourceTimecodeMs: number | null;
  }[],
  minimumPersonFrames = 1,
) {
  const bySubject = new Map<string, typeof detections>();
  for (const detection of detections) {
    if (!detection.personId) continue;
    const subject = bySubject.get(detection.personId) ?? [];
    subject.push(detection);
    bySubject.set(detection.personId, subject);
  }

  const remove: string[] = [];
  for (const subject of bySubject.values()) {
    const distinctFrames = new Set(subject.map(({ sourceTimecodeMs }) => sourceTimecodeMs)).size;
    if (subject[0].kind === SubjectKind.PERSON && distinctFrames < minimumPersonFrames) {
      remove.push(...subject.map(({ id }) => id));
    } else {
      // The query is score-descending, so the first crop is the clearest avatar.
      remove.push(...subject.slice(1).map(({ id }) => id));
    }
  }
  return remove;
}

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
    private readonly subjects: SubjectService,
    private readonly jobs: JobService,
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    const asset = await this.prisma.asset.findUnique({ where: { id: job.data.assetId } });
    if (!asset) return { skipped: 'asset gone' };

    if (asset.type !== AssetType.IMAGE && asset.type !== AssetType.VIDEO) {
      return { skipped: 'unsupported asset type' };
    }
    if (asset.type === AssetType.VIDEO && !this.ml.videoRecognitionEnabled) {
      return { skipped: 'video recognition disabled' };
    }

    // Vault content is never sent to the ML service: the whole point of locking
    // something is that it stops flowing through the rest of the system.
    if (asset.visibility === 'LOCKED') return { skipped: 'locked' };
    if (asset.visibility === 'HIDDEN') return { skipped: 'hidden companion' };

    if (!asset.previewPath) return { skipped: 'no preview yet' };

    if (!this.ml.faceRecognitionEnabled) return { skipped: 'face recognition disabled' };

    const frames = await this.framesFor(asset);
    if (frames.length === 0) {
      // A corrupt or audio-only video must not leave library progress stuck
      // forever. Nothing was replaced, so a previous successful scan is safe.
      const recognisedAt = new Date();
      await this.prisma.assetJobStatus.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          facesRecognizedAt: recognisedAt,
          petsRecognizedAt: recognisedAt,
        },
        update: { facesRecognizedAt: recognisedAt, petsRecognizedAt: recognisedAt },
      });
      this.logger.warn(`No decodable recognition frames in ${asset.originalFileName}`);
      return { faces: 0, pets: 0, subjects: 0, frames: 0, skipped: 'no decodable frames' };
    }
    const detections: RecognitionDetection[] = [];
    let petsRecognised = true;

    try {
      for (const frame of frames) {
        const analysed = await this.analyseFrame(frame);
        detections.push(...analysed.detections);
        petsRecognised &&= analysed.petsRecognised;
      }

      // Replace previous automatic detections only after every frame completed;
      // a failure midway through a video must not erase its previous results.
      await this.prisma.assetFace.deleteMany({
        where: { assetId: asset.id, sourceType: SourceType.MACHINE_LEARNING, isPinned: false },
      });

      for (const detection of detections) await this.insertDetection(asset.id, detection);
    } finally {
      await this.storage.removeMany(
        frames.filter((frame) => frame.temporary).map((frame) => frame.path),
      );
    }

    const subjects = await this.clustering.assignFacesForAsset(asset.id, asset.ownerId);
    if (asset.type === AssetType.VIDEO) {
      await this.removeRedundantVideoDetections(asset.id, frames.length > 1 ? 2 : 1);
    }

    // Automatic avatars follow the latest recognised photo, so a successful
    // upload is visible immediately. A cover deliberately chosen by the user
    // remains untouched.
    for (const subjectId of subjects) {
      const subject = await this.prisma.person.findUnique({
        where: { id: subjectId },
        select: { thumbnailPath: true, thumbnailIsCustom: true },
      });
      if (!subject?.thumbnailIsCustom) {
        await this.subjects.refreshThumbnail(subjectId);
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
        ...(petsRecognised ? { petsRecognizedAt: recognisedAt } : {}),
      },
      update: {
        facesRecognizedAt: recognisedAt,
        ...(petsRecognised ? { petsRecognizedAt: recognisedAt } : {}),
      },
    });

    const humanFaceCount = detections.filter(
      (detection) => detection.kind === SubjectKind.PERSON,
    ).length;
    const petCount = detections.length - humanFaceCount;
    if (detections.length > 0) {
      this.logger.debug(
        `${detections.length} detection(s) in ${asset.originalFileName} across ${subjects.length} subject(s)`,
      );
    }

    return {
      faces: humanFaceCount,
      pets: petCount,
      subjects: subjects.length,
      frames: frames.length,
    };
  }

  private async framesFor(asset: {
    id: string;
    ownerId: string;
    type: AssetType;
    previewPath: string | null;
    originalPath: string;
    encodedVideoPath: string | null;
  }): Promise<RecognitionFrame[]> {
    if (asset.type === AssetType.IMAGE) {
      return [{ path: asset.previewPath ?? asset.originalPath, timecodeMs: null, temporary: false }];
    }

    const source = asset.encodedVideoPath ?? asset.originalPath;
    const probe = await this.media.probeVideo(source);
    const timestamps = videoRecognitionTimestamps(
      probe.durationSeconds,
      Math.max(1, this.config.get('machineLearning.videoSampleIntervalSeconds', { infer: true })),
      Math.max(1, this.config.get('machineLearning.videoMaxFrames', { infer: true })),
    );
    const frames: RecognitionFrame[] = [];

    for (const [index, seconds] of timestamps.entries()) {
      const path = this.storage.buildIncomingPath(
        asset.ownerId,
        `${asset.id}-recognition-${String(index).padStart(3, '0')}.jpg`,
      );
      try {
        await this.storage.remove(path);
        await this.media.extractPosterFrame(source, path, seconds);
        frames.push({ path, timecodeMs: Math.round(seconds * 1000), temporary: true });
      } catch (error) {
        await this.storage.remove(path);
        this.logger.warn(
          `Skipping frame ${seconds.toFixed(2)}s in ${asset.originalPath}: ${(error as Error).message}`,
        );
      }
    }
    return frames;
  }

  private async analyseFrame(frame: RecognitionFrame) {
    // Run the pet detector first. Face detectors can mistake the front of a
    // dog or cat for a human face; a face centred inside a confirmed pet box
    // belongs to the pet, not the People tab.
    const petResult = await this.ml.detectPets(frame.path);
    const result = await this.ml.detectFaces(frame.path);
    if (!result) throw new Error('Face detection returned no result');
    const pets: DetectedPet[] = [...(petResult?.pets ?? [])];
    const isInsidePet = (face: DetectedFace) =>
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

    for (const face of result.faces) {
      if (isInsidePet(face)) continue;
      const recovered = await this.ml.classifyPetFaceCandidate(frame.path, face.boundingBox);
      if (recovered) pets.push({ ...recovered, boundingBox: face.boundingBox });
    }

    const humanFaces: DetectedFace[] = [];
    for (const face of result.faces.filter((candidate) => !isInsidePet(candidate))) {
      if (frame.timecodeMs !== null) {
        const sharpness = await this.media.regionSharpness(frame.path, face.boundingBox, {
          width: result.imageWidth,
          height: result.imageHeight,
        });
        const usable = isUsableVideoFace(
          face,
          result.imageWidth,
          result.imageHeight,
          sharpness,
          {
            minScore: this.config.get('machineLearning.videoFaceMinScore', { infer: true }),
            minSharpness: this.config.get('machineLearning.videoFaceMinSharpness', {
              infer: true,
            }),
          },
        );
        if (!usable) continue;
      }
      humanFaces.push(face);
    }

    const detections: RecognitionDetection[] = [
      ...humanFaces.map((face) => ({
        kind: SubjectKind.PERSON,
        species: null,
        boundingBox: face.boundingBox,
        score: face.score,
        embedding: face.embedding,
        imageWidth: result.imageWidth,
        imageHeight: result.imageHeight,
        sourceTimecodeMs: frame.timecodeMs,
      })),
      ...pets.map((pet) => ({
        kind: SubjectKind.PET,
        species: pet.label,
        boundingBox: pet.boundingBox,
        score: pet.score,
        embedding: pet.embedding,
        imageWidth: petResult?.imageWidth ?? result.imageWidth,
        imageHeight: petResult?.imageHeight ?? result.imageHeight,
        sourceTimecodeMs: frame.timecodeMs,
      })),
    ];

    return { detections, petsRecognised: petResult !== null };
  }

  private insertDetection(assetId: string, detection: RecognitionDetection) {
    return this.prisma.$executeRaw`
      INSERT INTO asset_faces (
        id, "assetId", "boundingBoxX1", "boundingBoxY1", "boundingBoxX2", "boundingBoxY2",
        "imageWidth", "imageHeight", score, embedding, kind, species, "sourceTimecodeMs",
        "sourceType", "isPinned", "createdAt"
      ) VALUES (
        gen_random_uuid(), ${assetId}::uuid,
        ${detection.boundingBox.x1}, ${detection.boundingBox.y1},
        ${detection.boundingBox.x2}, ${detection.boundingBox.y2},
        ${detection.imageWidth}, ${detection.imageHeight},
        ${detection.score}, ${`[${detection.embedding.join(',')}]`}::vector,
        ${detection.kind}::"SubjectKind", ${detection.species}, ${detection.sourceTimecodeMs},
        'MACHINE_LEARNING', false, NOW()
      )
    `;
  }

  /** One video should count once per subject, however many sampled frames contain them. */
  private async removeRedundantVideoDetections(assetId: string, minimumPersonFrames: number) {
    const detections = await this.prisma.assetFace.findMany({
      where: {
        assetId,
        personId: { not: null },
        sourceType: SourceType.MACHINE_LEARNING,
        isPinned: false,
      },
      select: { id: true, personId: true, kind: true, sourceTimecodeMs: true },
      orderBy: [{ score: 'desc' }],
    });
    const redundant = redundantVideoDetectionIds(detections, minimumPersonFrames);
    if (redundant.length === 0) return;

    const affectedSubjectIds = [
      ...new Set(
        detections
          .filter(({ id }) => redundant.includes(id))
          .flatMap(({ personId }) => (personId ? [personId] : [])),
      ),
    ];
    await this.prisma.assetFace.deleteMany({ where: { id: { in: redundant } } });

    const emptySubjects = await this.prisma.person.findMany({
      where: { id: { in: affectedSubjectIds }, name: '', faces: { none: {} } },
      select: { id: true, thumbnailPath: true },
    });
    if (emptySubjects.length > 0) {
      await this.prisma.person.deleteMany({
        where: { id: { in: emptySubjects.map(({ id }) => id) } },
      });
      await this.storage.removeMany(emptySubjects.map(({ thumbnailPath }) => thumbnailPath));
    }
  }
}

/** Library-wide re-clustering, triggered from the admin surface. */
@Processor(QUEUE.FACE_CLUSTER, { concurrency: 1 })
export class FaceClusterProcessor extends WorkerHost {
  constructor(
    private readonly clustering: FaceClusteringService,
    private readonly subjects: SubjectService,
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
    for (const group of groups) await this.subjects.generateThumbnail(group.id);

    return result;
  }
}
