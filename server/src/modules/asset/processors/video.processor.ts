import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE, type AssetJobData } from '../../../infra/job/job.constants';
import { MediaService } from '../../../infra/media/media.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';

/**
 * Produces a web-playable copy of a video.
 *
 * Concurrency is 1 on purpose: ffmpeg already saturates the available cores, so
 * running several at once just makes every one of them slower.
 */
@Processor(QUEUE.VIDEO, { concurrency: 1 })
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    const asset = await this.prisma.asset.findUnique({ where: { id: job.data.assetId } });
    if (!asset || asset.type !== 'VIDEO') return { skipped: 'not a video' };

    const probe = await this.media.probeVideo(asset.originalPath);

    if (!this.media.needsTranscode(probe)) {
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
      await this.media.transcodeVideo(asset.originalPath, destination, probe);
    } catch (error) {
      // A half-written mp4 would be served to players as a broken file.
      await this.storage.remove(destination);
      throw error;
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
}
