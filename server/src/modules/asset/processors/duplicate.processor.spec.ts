import { describe, expect, it, vi } from 'vitest';
import { JOB, QUEUE } from '../../../infra/job/job.constants';
import { DuplicateProcessor } from './duplicate.processor';

describe('DuplicateProcessor', () => {
  it('checks an owner once and completes every equivalent queued asset', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const removeQueuedAssetJobs = vi.fn().mockResolvedValue(2);
    const detectForOwner = vi.fn().mockResolvedValue({ groups: 4, assets: 9 });
    const prisma = {
      asset: {
        findUnique: vi.fn().mockResolvedValue({
          ownerId: 'owner-id',
          deletedAt: null,
          jobStatus: { duplicatesDetectedAt: null },
        }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'asset-1',
          jobStatus: { duplicatesDetectedAt: null },
        }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'asset-1' },
          { id: 'asset-2' },
          { id: 'asset-3' },
        ]),
      },
      assetJobStatus: {
        findMany: vi.fn().mockResolvedValue([
          { assetId: 'asset-1' },
          { assetId: 'asset-2' },
          { assetId: 'asset-3' },
        ]),
        updateMany,
      },
    };
    const processor = new DuplicateProcessor(
      prisma as never,
      { detectForOwner } as never,
      { removeQueuedAssetJobs } as never,
      {
        runHeavyProcessing: vi.fn(async (operation: () => Promise<unknown>) => operation()),
      } as never,
    );

    await expect(
      processor.process({ data: { assetId: 'asset-1' } } as never),
    ).resolves.toEqual({ groups: 4, assets: 9, checked: 3 });
    expect(detectForOwner).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith({
      where: { assetId: { in: ['asset-1', 'asset-2', 'asset-3'] } },
      data: { duplicatesDetectedAt: expect.any(Date) },
    });
    expect(removeQueuedAssetJobs).toHaveBeenCalledWith(
      QUEUE.DUPLICATE,
      JOB.DETECT_DUPLICATES,
      ['asset-1', 'asset-2', 'asset-3'],
    );
  });

  it('does not rescan an owner for an asset covered by the previous pass', async () => {
    const detectForOwner = vi.fn();
    const runHeavyProcessing = vi.fn();
    const processor = new DuplicateProcessor(
      {
        asset: {
          findUnique: vi.fn().mockResolvedValue({
            ownerId: 'owner-id',
            deletedAt: null,
            jobStatus: { duplicatesDetectedAt: new Date() },
          }),
        },
      } as never,
      { detectForOwner } as never,
      {} as never,
      { runHeavyProcessing } as never,
    );

    await expect(
      processor.process({ data: { assetId: 'asset-1' } } as never),
    ).resolves.toEqual({ skipped: 'duplicates already checked' });
    expect(runHeavyProcessing).not.toHaveBeenCalled();
    expect(detectForOwner).not.toHaveBeenCalled();
  });
});
