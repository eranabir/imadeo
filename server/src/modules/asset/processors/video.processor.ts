import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { Asset } from '../../../db';
import {
  JOB,
  PROCESSORS_AUTORUN,
  QUEUE,
  type AssetJobData,
} from '../../../infra/job/job.constants';
import { BackgroundTaskGate } from '../../../infra/job/background-task-gate.service';
import {
  MediaProcessingCancelledError,
  MediaService,
} from '../../../infra/media/media.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';
import { ThumbnailProcessor } from './thumbnail.processor';

/**
 * Produces a web-playable copy of a video.
 *
 * Concurrency is 1 on purpose: ffmpeg already saturates the available cores, so
 * running several at once just makes every one of them slower.
 */
@Processor(QUEUE.VIDEO, { concurrency: 1, autorun: PROCESSORS_AUTORUN })
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly thumbnails: ThumbnailProcessor,
    private readonly backgroundTasks: BackgroundTaskGate,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    // Video posters share this one-at-a-time worker with transcoding. A large
    // movie can no longer occupy one of the three image-thumbnail workers.
    if (job.name === JOB.GENERATE_THUMBNAILS) return this.thumbnails.process(job);

    const asset = await this.prisma.asset.findUnique({ where: { id: job.data.assetId } });
    if (!asset || asset.type !== 'VIDEO') return { skipped: 'not a video' };
    if (asset.deletedAt) return { skipped: 'asset deleted' };

    return this.backgroundTasks.runHeavyProcessing(() => this.transcode(asset), QUEUE.VIDEO);
  }

  private async transcode(asset: Asset) {
    if (!(await this.assetStillActive(asset.id))) return { skipped: 'asset deleted' };

    const probe = await this.media.probeVideo(asset.originalPath);

    if (!this.media.needsTranscode(probe)) {
      if (!(await this.assetStillActive(asset.id))) return { skipped: 'asset deleted' };
      // The original already plays in a browser; a second copy would waste space.
      await this.prisma.assetJobStatus.upsert({
        where: { assetId: asset.id },
        create: { assetId: asset.id, videoEncodedAt: new Date() },
        update: { videoEncodedAt: new Date() },
      });
      return { skipped: 'original is already web playable', codec: probe.videoCodec };
    }

    const destination = this.storage.buildDerivativePath('video', asset.ownerId, asset.id);

    try {
      await this.media.transcodeVideo(
        asset.originalPath,
        destination,
        probe,
        () => this.assetStillActive(asset.id),
      );
    } catch (error) {
      // A half-written mp4 would be served to players as a broken file.
      await this.storage.remove(destination);
      if (
        error instanceof MediaProcessingCancelledError ||
        !(await this.assetStillActive(asset.id))
      ) {
        return { skipped: 'asset deleted' };
      }
      throw error;
    }

    if (!(await this.assetStillActive(asset.id))) {
      await this.storage.remove(destination);
      return { skipped: 'asset deleted' };
    }

    await this.prisma.$transaction([
      this.prisma.asset.update({
        where: { id: asset.id },
        data: { encodedVideoPath: destination },
      }),
      this.prisma.assetJobStatus.upsert({
        where: { assetId: asset.id },
        create: { assetId: asset.id, videoEncodedAt: new Date() },
        update: { videoEncodedAt: new Date() },
      }),
    ]);

    return { destination, size: await this.storage.size(destination) };
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
