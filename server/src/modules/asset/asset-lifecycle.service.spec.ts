import { describe, expect, it, vi } from 'vitest';
import { AssetLifecycleService } from './asset-lifecycle.service';

describe('AssetLifecycleService.deletePermanently', () => {
  it('removes only trashed owned assets, their files and their quota usage', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateUser = vi.fn().mockResolvedValue({});
    const removeMany = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      asset: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'asset-id',
            originalPath: '/data/original.jpg',
            thumbnailPath: '/data/thumb.jpg',
            previewPath: null,
            encodedVideoPath: null,
            fileSizeInByte: 42n,
          },
        ]),
        deleteMany,
      },
      user: { update: updateUser },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new AssetLifecycleService(
      prisma as never,
      { removeMany } as never,
      { refreshThumbnailsForAssets: refresh } as never,
    );

    await expect(service.deletePermanently('owner-id', ['asset-id'])).resolves.toEqual({
      deleted: 1,
      freedBytes: 42n,
    });
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['asset-id'] }, ownerId: 'owner-id', deletedAt: { not: null } },
      }),
    );
    expect(removeMany).toHaveBeenCalledWith([
      '/data/original.jpg',
      '/data/thumb.jpg',
      null,
      null,
    ]);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['asset-id'] }, ownerId: 'owner-id', deletedAt: { not: null } },
    });
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: 'owner-id' },
      data: { quotaUsageInBytes: { decrement: 42n } },
    });
    expect(refresh).toHaveBeenCalledWith(['asset-id']);
  });
});
