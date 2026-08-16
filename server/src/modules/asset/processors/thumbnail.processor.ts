import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { extname } from 'node:path';
import type { AppConfig } from '../../../config/configuration';
import { AssetType } from '../../../db';
import { JOB, QUEUE, type AssetJobData } from '../../../infra/job/job.constants';
import { JobService } from '../../../infra/job/job.service';
import { MediaService } from '../../../infra/media/media.service';
import { MachineLearningService } from '../../../infra/ml/ml.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';

/**
 * Produces the grid thumbnail, the viewer preview and the thumbhash placeholder.
 * Videos get a poster frame first, then go through the same image path.
 */
@Processor(QUEUE.THUMBNAIL, { concurrency: 3 })
export class ThumbnailProcessor extends WorkerHost {
  private readonly logger = new Logger(ThumbnailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly jobs: JobService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly ml: MachineLearningService,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    const asset = await this.prisma.asset.findUnique({ where: { id: job.data.assetId } });
    if (!asset) return { skipped: 'asset gone' };
    if (asset.deletedAt) return { skipped: 'asset deleted' };

    // The file the image pipeline will actually read. For a video or a RAW this
    // is an intermediate JPEG rather than the original.
    let source = asset.originalPath;
    let temporary: string | null = null;

    try {
      if (asset.type === AssetType.VIDEO) {
        temporary = this.storage.buildIncomingPath(asset.ownerId, `${asset.id}-poster.jpg`);
        // One second in usually avoids a black or fading first frame.
        const probe = await this.media.probeVideo(asset.originalPath).catch(() => null);
        const seek = probe && probe.durationSeconds > 2 ? 1 : 0;
        source = await this.media.extractPosterFrame(asset.originalPath, temporary, seek);
      } else if (!this.media.canSharpDecode(extname(asset.originalPath))) {
        temporary = this.storage.buildIncomingPath(asset.ownerId, `${asset.id}-decoded.jpg`);
        source = await this.media.extractToJpeg(asset.originalPath, temporary);
      }

      /**
       * The extension list is a guess, so a failure to decode is not fatal.
       *
       * HEIC is the case that forced this. sharp claims the format, and then
       * libheif refuses every full-size iPhone photo: those are stored as a grid
       * of ~48 tiles, and libheif caps a file at 16 `iref` references by default.
       * The asset landed with no thumbnail at all and the web client had nothing
       * to show — browsers cannot render HEIC themselves either.
       *
       * ffmpeg already sits behind this path for RAW, so anything sharp turns
       * out not to be able to open goes the same way rather than being dropped.
       */
      let rendered: { thumbnailPath: string; previewPath: string };
      try {
        rendered = await this.media.generateImageThumbnails(source, asset.ownerId, asset.id);
      } catch (error) {
        if (temporary) throw error; // Already came through ffmpeg; nothing left to try.

        this.logger.warn(
          `sharp could not decode ${asset.originalFileName}; retrying through ffmpeg: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );

        temporary = this.storage.buildIncomingPath(asset.ownerId, `${asset.id}-decoded.jpg`);
        source = await this.media.extractToJpeg(asset.originalPath, temporary);
        rendered = await this.media.generateImageThumbnails(source, asset.ownerId, asset.id);
      }

      const { thumbnailPath, previewPath } = rendered;

      const thumbhash = await this.media.generateThumbhash(source).catch(() => null);
      // Computed from the same decoded source the thumbnails came from, so a
      // RAW or a video is hashed from its rendered frame rather than bytes
      // sharp cannot read.
      const perceptualHash = await this.media.perceptualHash(source).catch(() => null);

      if (!(await this.assetStillActive(asset.id))) {
        await this.storage.removeMany([thumbnailPath, previewPath]);
        return { skipped: 'asset deleted' };
      }

      await this.prisma.$transaction([
        this.prisma.asset.update({
          where: { id: asset.id },
          data: { thumbnailPath, previewPath, thumbhash, perceptualHash },
        }),
        this.prisma.assetJobStatus.upsert({
          where: { assetId: asset.id },
          create: { assetId: asset.id, thumbnailAt: new Date() },
          update: { thumbnailAt: new Date() },
        }),
      ]);

      // Downstream stages only make sense once a preview exists: the ML service
      // reads the preview rather than a 60 MB original.
      if (asset.type === AssetType.VIDEO) {
        await this.jobs.enqueue(QUEUE.VIDEO, JOB.TRANSCODE_VIDEO, { assetId: asset.id });
      }
      if (this.config.get('duplicates.enabled', { infer: true })) {
        await this.jobs.enqueue(QUEUE.DUPLICATE, JOB.DETECT_DUPLICATES, { assetId: asset.id });
      }
      if (this.config.get('machineLearning.enabled', { infer: true })) {
        await this.jobs.enqueue(QUEUE.SMART_SEARCH, JOB.ENCODE_CLIP, { assetId: asset.id });
      }
      if (this.ml.faceRecognitionEnabled) {
        if (asset.type !== AssetType.VIDEO || this.ml.videoRecognitionEnabled) {
          await this.jobs.enqueue(
            QUEUE.FACE_DETECTION,
            JOB.DETECT_FACES,
            { assetId: asset.id },
            asset.type === AssetType.VIDEO ? 20 : undefined,
          );
        }
      }

      return { thumbnailPath, previewPath };
    } finally {
      if (temporary) await this.storage.remove(temporary);
    }
  }

  private async assetStillActive(assetId: string) {
    return Boolean(
      await this.prisma.asset.findFirst({
        where: { id: assetId, deletedAt: null },
        select: { id: true },
      }),
    );
  }
}
