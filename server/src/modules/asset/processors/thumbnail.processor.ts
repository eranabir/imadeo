import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { join } from 'node:path';
import { extname } from 'node:path';
import type { AppConfig } from '../../../config/configuration';
import { AssetType } from '../../../db';
import { JOB, QUEUE, type AssetJobData } from '../../../infra/job/job.constants';
import { JobService } from '../../../infra/job/job.service';
import { MediaService } from '../../../infra/media/media.service';
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
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    const asset = await this.prisma.asset.findUnique({ where: { id: job.data.assetId } });
    if (!asset) return { skipped: 'asset gone' };

    // The file the image pipeline will actually read. For a video or a RAW this
    // is an intermediate JPEG rather than the original.
    let source = asset.originalPath;
    let temporary: string | null = null;

    try {
      if (asset.type === AssetType.VIDEO) {
        temporary = join(
          this.config.get('storage.incoming', { infer: true }),
          `${asset.id}-poster.jpg`,
        );
        // One second in usually avoids a black or fading first frame.
        const probe = await this.media.probeVideo(asset.originalPath).catch(() => null);
        const seek = probe && probe.durationSeconds > 2 ? 1 : 0;
        source = await this.media.extractPosterFrame(asset.originalPath, temporary, seek);
      } else if (!this.media.canSharpDecode(extname(asset.originalPath))) {
        temporary = join(
          this.config.get('storage.incoming', { infer: true }),
          `${asset.id}-decoded.jpg`,
        );
        source = await this.media.extractToJpeg(asset.originalPath, temporary);
      }

      const { thumbnailPath, previewPath } = await this.media.generateImageThumbnails(
        source,
        asset.ownerId,
        asset.id,
      );

      const thumbhash = await this.media.generateThumbhash(source).catch(() => null);
      // Computed from the same decoded source the thumbnails came from, so a
      // RAW or a video is hashed from its rendered frame rather than bytes
      // sharp cannot read.
      const perceptualHash = await this.media.perceptualHash(source).catch(() => null);

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
        await this.jobs.enqueue(QUEUE.FACE_DETECTION, JOB.DETECT_FACES, { assetId: asset.id });
      }

      return { thumbnailPath, previewPath };
    } finally {
      if (temporary) await this.storage.remove(temporary);
    }
  }
}
