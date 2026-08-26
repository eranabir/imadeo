import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  JOB,
  PROCESSORS_AUTORUN,
  QUEUE,
  type AssetJobData,
} from '../../../infra/job/job.constants';
import { BackgroundTaskGate } from '../../../infra/job/background-task-gate.service';
import { JobService } from '../../../infra/job/job.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { DuplicateService } from '../duplicate.service';

/**
 * Re-groups an owner's duplicates after a new asset finishes its thumbnails.
 *
 * Concurrency is 1 on purpose. Detection rewrites group ids for the whole
 * library, so two passes running at once would interleave and leave assets
 * pointing at groups the other just replaced.
 */
@Processor(QUEUE.DUPLICATE, { concurrency: 1, autorun: PROCESSORS_AUTORUN })
export class DuplicateProcessor extends WorkerHost {
  private readonly logger = new Logger(DuplicateProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly duplicates: DuplicateService,
    private readonly jobs: JobService,
    private readonly backgroundTasks: BackgroundTaskGate,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: job.data.assetId },
      select: {
        ownerId: true,
        deletedAt: true,
        jobStatus: { select: { duplicatesDetectedAt: true } },
      },
    });
    if (!asset) return { skipped: 'asset gone' };
    if (asset.deletedAt) return { skipped: 'asset deleted' };
    if (asset.jobStatus?.duplicatesDetectedAt) return { skipped: 'duplicates already checked' };

    return this.backgroundTasks.runHeavyProcessing(async () => {
      const activeBefore = await this.prisma.asset.findFirst({
        where: { id: job.data.assetId, deletedAt: null },
        select: {
          id: true,
          jobStatus: { select: { duplicatesDetectedAt: true } },
        },
      });
      if (!activeBefore) return { skipped: 'asset deleted' };
      if (activeBefore.jobStatus?.duplicatesDetectedAt) {
        return { skipped: 'duplicates already checked' };
      }

      // Detection rebuilds the owner's complete duplicate graph. Capture all
      // ready assets that need that same pass so a 2,000-file upload does not
      // rebuild the 16,000-file library 2,000 separate times.
      const pending = await this.prisma.assetJobStatus.findMany({
        where: {
          duplicatesDetectedAt: null,
          thumbnailAt: { not: null },
          asset: { ownerId: asset.ownerId, deletedAt: null },
        },
        select: { assetId: true },
      });

      const result = await this.duplicates.detectForOwner(asset.ownerId);

      const pendingIds = pending.map(({ assetId }) => assetId);
      const checkedIds: string[] = [];
      for (let index = 0; index < pendingIds.length; index += 1_000) {
        const batch = pendingIds.slice(index, index + 1_000);
        const active = await this.prisma.asset.findMany({
          where: { id: { in: batch }, deletedAt: null },
          select: { id: true },
        });
        const activeIds = active.map(({ id }) => id);
        if (activeIds.length === 0) continue;
        await this.prisma.assetJobStatus.updateMany({
          where: { assetId: { in: activeIds } },
          data: { duplicatesDetectedAt: new Date() },
        });
        checkedIds.push(...activeIds);
      }
      if (checkedIds.length > 0) {
        await this.jobs.removeQueuedAssetJobs(
          QUEUE.DUPLICATE,
          JOB.DETECT_DUPLICATES,
          checkedIds,
        );
      }

      return { ...result, checked: checkedIds.length };
    }, QUEUE.DUPLICATE);
  }
}
