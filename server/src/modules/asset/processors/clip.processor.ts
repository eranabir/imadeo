import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE, type AssetJobData } from '../../../infra/job/job.constants';
import { MachineLearningService } from '../../../infra/ml/ml.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/**
 * Describes one photo as a vector, so it can be found by what is in it.
 *
 * Runs from the preview rather than the original: CLIP works at 224px, so
 * sending a 60 MB raw file would cost a great deal and change nothing.
 */
@Processor(QUEUE.SMART_SEARCH, { concurrency: 2 })
export class ClipProcessor extends WorkerHost {
  private readonly logger = new Logger(ClipProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ml: MachineLearningService,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    const asset = await this.prisma.asset.findUnique({ where: { id: job.data.assetId } });
    if (!asset) return { skipped: 'asset gone' };

    // Vault content never leaves the app, the same rule the face pipeline follows.
    if (asset.visibility === 'LOCKED') return { skipped: 'locked' };

    const source = asset.previewPath ?? asset.originalPath;
    if (!source) return { skipped: 'no preview yet' };

    const embedding = await this.ml.encodeImage(source);
    // Null means the model is switched off, which is a supported configuration
    // rather than a failure — searching by content simply stays unavailable.
    if (!embedding) return { skipped: 'search encoding unavailable' };

    // `vector(512)` is beyond what Prisma can express, so this goes through SQL.
    await this.prisma.$executeRaw`
      INSERT INTO smart_search ("assetId", embedding)
      VALUES (${asset.id}::uuid, ${`[${embedding.join(',')}]`}::vector)
      ON CONFLICT ("assetId") DO UPDATE SET embedding = EXCLUDED.embedding
    `;

    await this.prisma.assetJobStatus.upsert({
      where: { assetId: asset.id },
      create: { assetId: asset.id, smartSearchAt: new Date() },
      update: { smartSearchAt: new Date() },
    });

    return { encoded: true };
  }
}
