import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { AssetType, AssetVisibility } from '../../db';
import { JOB, QUEUE, type QueueName } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { ProcessingSignalService } from '../../infra/job/processing-signal.service';
import { MachineLearningService } from '../../infra/ml/ml.service';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Owns processing state transitions when assets enter or leave Trash. */
@Injectable()
export class AssetProcessingService {
  private static readonly BATCH_SIZE = 500;
  private readonly logger = new Logger(AssetProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobService,
    private readonly signals: ProcessingSignalService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly ml: MachineLearningService,
  ) {}

  async stop(userId: string, assetIds: string[]) {
    const ids = [...new Set(assetIds)];
    if (ids.length === 0) return { removedJobs: 0 };

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: ids }, ownerId: userId },
      select: { uploadId: true },
    });
    await this.signals.cancelUploadReceipts(
      userId,
      assets.flatMap(({ uploadId }) => (uploadId ? [uploadId] : [])),
    );
    try {
      return { removedJobs: await this.jobs.cancelAssetProcessing(ids) };
    } catch (error) {
      // The database flag is still authoritative and every processor checks it.
      // Redis cleanup can safely retry through the normal skipped-job path.
      this.logger.warn(`Could not remove queued work for trashed assets: ${String(error)}`);
      return { removedJobs: 0 };
    }
  }

  async uploadReceiptIsCancelled(userId: string, uploadId: string) {
    return this.signals.uploadReceiptIsCancelled(userId, uploadId);
  }

  /** Restarts only stages that were incomplete when the asset entered Trash. */
  async resume(userId: string, assetIds: string[]) {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: [...new Set(assetIds)] }, ownerId: userId, deletedAt: null },
      select: {
        id: true,
        type: true,
        visibility: true,
        uploadId: true,
        jobStatus: true,
      },
    });
    await this.signals.clearCancelledUploadReceipts(
      userId,
      assets.flatMap(({ uploadId }) => (uploadId ? [uploadId] : [])),
    );

    const metadata = assets.filter(({ jobStatus }) => !jobStatus?.metadataExtractedAt);
    const thumbnails = assets.filter(
      ({ jobStatus }) => jobStatus?.metadataExtractedAt && !jobStatus.thumbnailAt,
    );
    const ready = assets.filter(({ jobStatus }) => Boolean(jobStatus?.thumbnailAt));

    await this.enqueueMissing(
      QUEUE.METADATA,
      JOB.EXTRACT_METADATA,
      metadata.map(({ id }) => id),
    );
    await this.enqueueMissing(
      QUEUE.THUMBNAIL,
      JOB.GENERATE_THUMBNAILS,
      thumbnails.filter(({ type }) => type !== AssetType.VIDEO).map(({ id }) => id),
    );
    await this.enqueueMissing(
      QUEUE.VIDEO,
      JOB.GENERATE_THUMBNAILS,
      thumbnails.filter(({ type }) => type === AssetType.VIDEO).map(({ id }) => id),
    );
    await this.enqueueMissing(
      QUEUE.VIDEO,
      JOB.TRANSCODE_VIDEO,
      ready
        .filter(({ type, jobStatus }) => type === AssetType.VIDEO && !jobStatus?.videoEncodedAt)
        .map(({ id }) => id),
    );

    if (this.config.get('duplicates.enabled', { infer: true })) {
      await this.enqueueMissing(
        QUEUE.DUPLICATE,
        JOB.DETECT_DUPLICATES,
        ready.filter(({ jobStatus }) => !jobStatus?.duplicatesDetectedAt).map(({ id }) => id),
      );
    }
    if (this.config.get('machineLearning.enabled', { infer: true })) {
      await this.enqueueMissing(
        QUEUE.SMART_SEARCH,
        JOB.ENCODE_CLIP,
        ready
          .filter(
            ({ visibility, jobStatus }) =>
              visibility !== AssetVisibility.LOCKED &&
              visibility !== AssetVisibility.HIDDEN &&
              !jobStatus?.smartSearchAt,
          )
          .map(({ id }) => id),
      );
    }
    if (this.ml.faceRecognitionEnabled) {
      await this.enqueueMissing(
        QUEUE.FACE_DETECTION,
        JOB.DETECT_FACES,
        ready
          .filter(
            ({ type, visibility, jobStatus }) =>
              visibility !== AssetVisibility.LOCKED &&
              visibility !== AssetVisibility.HIDDEN &&
              (type !== AssetType.VIDEO || this.ml.videoRecognitionEnabled) &&
              (!jobStatus?.facesRecognizedAt || !jobStatus.petsRecognizedAt),
          )
          .map(({ id }) => id),
      );
    }

    return assets.length;
  }

  private async enqueueMissing(queue: QueueName, name: string, assetIds: string[]) {
    for (let index = 0; index < assetIds.length; index += AssetProcessingService.BATCH_SIZE) {
      const batch = assetIds.slice(index, index + AssetProcessingService.BATCH_SIZE);
      await this.jobs.releaseJobIds(queue, name, batch);
      await this.jobs.enqueueMany(
        queue,
        name,
        batch.map((assetId) => ({ assetId })),
      );
    }
  }
}
