import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE, type AssetJobData } from '../../../infra/job/job.constants';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { DuplicateService } from '../duplicate.service';

/**
 * Re-groups an owner's duplicates after a new asset finishes its thumbnails.
 *
 * Concurrency is 1 on purpose. Detection rewrites group ids for the whole
 * library, so two passes running at once would interleave and leave assets
 * pointing at groups the other just replaced.
 */
@Processor(QUEUE.DUPLICATE, { concurrency: 1 })
export class DuplicateProcessor extends WorkerHost {
  private readonly logger = new Logger(DuplicateProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly duplicates: DuplicateService,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: job.data.assetId },
      select: { ownerId: true, deletedAt: true },
    });
    if (!asset) return { skipped: 'asset gone' };
    if (asset.deletedAt) return { skipped: 'asset deleted' };

    const result = await this.duplicates.detectForOwner(asset.ownerId);

    const active = await this.prisma.asset.findFirst({
      where: { id: job.data.assetId, deletedAt: null },
      select: { id: true },
    });
    if (!active) return { skipped: 'asset deleted' };

    await this.prisma.assetJobStatus.upsert({
      where: { assetId: job.data.assetId },
      create: { assetId: job.data.assetId, duplicatesDetectedAt: new Date() },
      update: { duplicatesDetectedAt: new Date() },
    });

    return result;
  }
}
