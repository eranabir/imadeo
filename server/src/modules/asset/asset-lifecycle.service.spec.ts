import { describe, expect, it, vi } from 'vitest';
import { AssetLifecycleService } from './asset-lifecycle.service';

const immediateBackgroundTasks = () => ({
  runMediaProcessing: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}) as never;

const processingLifecycle = () => ({
  stop: vi.fn().mockResolvedValue({ removedJobs: 0 }),
  resume: vi.fn().mockResolvedValue(0),
  uploadReceiptIsCancelled: vi.fn().mockResolvedValue(false),
}) as never;

describe('AssetLifecycleService.moveToTrash', () => {
  it('trashes the original and Live Photo companion without removing their locations', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const processing = processingLifecycle() as unknown as {
      stop: ReturnType<typeof vi.fn>;
    };
    const service = new AssetLifecycleService(
      {
        asset: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'still-id', livePhotoVideoId: 'motion-id' },
          ]),
          updateMany,
        },
      } as never,
      {} as never,
      { refreshThumbnailsForAssets: refresh } as never,
      immediateBackgroundTasks(),
      processing as never,
    );

    await expect(service.moveToTrash('owner-id', ['still-id'])).resolves.toEqual({
      trashed: 2,
      assetIds: ['still-id', 'motion-id'],
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['still-id', 'motion-id'] },
        ownerId: 'owner-id',
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date), status: 'TRASHED' },
    });
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('folderId');
    expect(processing.stop).toHaveBeenCalledWith('owner-id', ['still-id', 'motion-id']);
    expect(refresh).toHaveBeenCalledWith(['still-id', 'motion-id']);
  });
});

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
      immediateBackgroundTasks(),
      processingLifecycle(),
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
      where: { id: { in: ['asset-id'] }, ownerId: 'owner-id' },
    });
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: 'owner-id' },
      data: { quotaUsageInBytes: { decrement: 42n } },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Array),
      { maxWait: 30_000, timeout: 60_000 },
    );
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      removeMany.mock.invocationCallOrder[0],
    );
    expect(refresh).toHaveBeenCalledWith(['asset-id']);
  });

  it('keeps files intact when the database deletion cannot commit', async () => {
    const removeMany = vi.fn().mockResolvedValue(undefined);
    const service = new AssetLifecycleService(
      {
        asset: {
          findMany: vi.fn().mockResolvedValue([{
            id: 'asset-id',
            livePhotoVideoId: null,
            originalPath: '/data/original.jpg',
            thumbnailPath: null,
            previewPath: null,
            encodedVideoPath: null,
            fileSizeInByte: 42n,
          }]),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        user: { update: vi.fn().mockResolvedValue({}) },
        $transaction: vi.fn().mockRejectedValue(new Error('transaction expired')),
      } as never,
      { removeMany } as never,
      { refreshThumbnailsForAssets: vi.fn() } as never,
      immediateBackgroundTasks(),
      processingLifecycle(),
    );

    await expect(service.deletePermanently('owner-id', ['asset-id'])).rejects.toThrow(
      'transaction expired',
    );
    expect(removeMany).not.toHaveBeenCalled();
  });

  it('deletes a large trash collection in bounded transactions', async () => {
    const assets = Array.from({ length: 250 }, (_, index) => ({
      id: `asset-${index}`,
      livePhotoVideoId: null,
      originalPath: `/data/${index}.jpg`,
      thumbnailPath: null,
      previewPath: null,
      encodedVideoPath: null,
      fileSizeInByte: 1n,
    }));
    const transaction = vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations));
    const service = new AssetLifecycleService(
      {
        asset: {
          findMany: vi.fn().mockResolvedValue(assets),
          deleteMany: vi.fn().mockResolvedValue({ count: 100 }),
        },
        user: { update: vi.fn().mockResolvedValue({}) },
        $transaction: transaction,
      } as never,
      { removeMany: vi.fn().mockResolvedValue(undefined) } as never,
      { refreshThumbnailsForAssets: vi.fn().mockResolvedValue(undefined) } as never,
      immediateBackgroundTasks(),
      processingLifecycle(),
    );

    await expect(service.deletePermanently('owner-id', assets.map(({ id }) => id))).resolves.toEqual({
      deleted: 250,
      freedBytes: 250n,
    });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not report a committed deletion as failed when cover cleanup fails', async () => {
    const service = new AssetLifecycleService(
      {
        asset: {
          findMany: vi.fn().mockResolvedValue([{
            id: 'asset-id',
            livePhotoVideoId: null,
            originalPath: '/data/original.jpg',
            thumbnailPath: null,
            previewPath: null,
            encodedVideoPath: null,
            fileSizeInByte: 42n,
          }]),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        user: { update: vi.fn().mockResolvedValue({}) },
        $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
      } as never,
      { removeMany: vi.fn().mockResolvedValue(undefined) } as never,
      { refreshThumbnailsForAssets: vi.fn().mockRejectedValue(new Error('cover failed')) } as never,
      immediateBackgroundTasks(),
      processingLifecycle(),
    );

    await expect(service.deletePermanently('owner-id', ['asset-id'])).resolves.toEqual({
      deleted: 1,
      freedBytes: 42n,
    });
  });

  it('removes a hidden Live Photo motion clip with its trashed still', async () => {
    const still = {
      id: 'still-id',
      livePhotoVideoId: 'video-id',
      originalPath: '/data/still.heic',
      thumbnailPath: '/data/still-thumb.jpg',
      previewPath: '/data/still-preview.jpg',
      encodedVideoPath: null,
      fileSizeInByte: 40n,
    };
    const video = {
      id: 'video-id',
      livePhotoVideoId: null,
      originalPath: '/data/motion.mov',
      thumbnailPath: '/data/motion-thumb.jpg',
      previewPath: '/data/motion-preview.jpg',
      encodedVideoPath: '/data/motion.mp4',
      fileSizeInByte: 60n,
    };
    const findMany = vi.fn().mockResolvedValueOnce([still]).mockResolvedValueOnce([video]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const updateUser = vi.fn().mockResolvedValue({});
    const removeMany = vi.fn().mockResolvedValue(undefined);
    const service = new AssetLifecycleService(
      {
        asset: { findMany, deleteMany },
        user: { update: updateUser },
        $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
      } as never,
      { removeMany } as never,
      { refreshThumbnailsForAssets: vi.fn().mockResolvedValue(undefined) } as never,
      immediateBackgroundTasks(),
      processingLifecycle(),
    );

    await expect(service.deletePermanently('owner-id', ['still-id'])).resolves.toEqual({
      deleted: 2,
      freedBytes: 100n,
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['still-id', 'video-id'] },
        ownerId: 'owner-id',
      },
    });
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: 'owner-id' },
      data: { quotaUsageInBytes: { decrement: 100n } },
    });
  });
});
