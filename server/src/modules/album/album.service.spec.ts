import { describe, expect, it, vi } from 'vitest';
import { AlbumService } from './album.service';

describe('AlbumService asset sorting', () => {
  it('groups album media by type with deterministic ordering', () => {
    const service = new AlbumService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const orderBy = (
      service as unknown as {
        orderBy: (sortBy: string, order: 'asc' | 'desc') => unknown;
      }
    ).orderBy('type', 'asc');

    expect(orderBy).toEqual([
      { asset: { type: 'asc' } },
      { asset: { originalFileName: 'asc' } },
      { assetId: 'asc' },
    ]);
  });
});

describe('AlbumService.getAssetIds', () => {
  it('returns the complete album selection without the grid page limit', async () => {
    const rows = Array.from({ length: 359 }, (_, index) => ({ assetId: `asset-${index}` }));
    const findMany = vi.fn().mockResolvedValue(rows);
    const service = new AlbumService(
      { albumAsset: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'getAccess').mockResolvedValue('owner');

    const result = await service.getAssetIds({ user: { id: 'owner-id' } } as never, 'album-id');

    expect(result.ids).toHaveLength(359);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        albumId: 'album-id',
        asset: {
          deletedAt: null,
          isDeviceOnly: false,
          visibility: { not: 'HIDDEN' },
        },
      },
      select: { assetId: true },
      orderBy: [{ asset: { localDateTime: 'desc' } }, { assetId: 'desc' }],
    });
  });
});

describe('AlbumService moving media into an album', () => {
  it('adds album membership and removes owned media from its source folder atomically', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateAlbum = vi.fn().mockResolvedValue({});
    const updateAssets = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations));
    const service = new AlbumService(
      {
        album: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'album-id',
            isLocked: false,
            thumbnailAssetId: null,
          }),
          update: updateAlbum,
        },
        albumAsset: { findMany: vi.fn().mockResolvedValue([]), createMany },
        partner: { findMany: vi.fn().mockResolvedValue([]) },
        asset: {
          findMany: vi.fn().mockResolvedValue([{ id: 'asset-id' }]),
          updateMany: updateAssets,
        },
        $transaction: transaction,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'getAccess').mockResolvedValue('owner');

    await expect(
      service.addAssets(
        { user: { id: 'owner-id' } } as never,
        'album-id',
        ['asset-id'],
        true,
      ),
    ).resolves.toEqual([{ id: 'asset-id', success: true, error: undefined }]);

    expect(createMany).toHaveBeenCalledWith({
      data: [{ albumId: 'album-id', assetId: 'asset-id', addedById: 'owner-id' }],
      skipDuplicates: true,
    });
    expect(updateAssets).toHaveBeenCalledWith({
      where: { id: { in: ['asset-id'] }, ownerId: 'owner-id' },
      data: { folderId: null },
    });
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('still removes the folder when the photo already belongs to the album', async () => {
    const updateAssets = vi.fn().mockResolvedValue({ count: 1 });
    const service = new AlbumService(
      {
        album: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({
            id: 'album-id',
            isLocked: false,
            thumbnailAssetId: 'asset-id',
          }),
        },
        albumAsset: { findMany: vi.fn().mockResolvedValue([{ assetId: 'asset-id' }]) },
        partner: { findMany: vi.fn().mockResolvedValue([]) },
        asset: {
          findMany: vi.fn().mockResolvedValue([{ id: 'asset-id' }]),
          updateMany: updateAssets,
        },
        $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'getAccess').mockResolvedValue('owner');

    await expect(
      service.addAssets(
        { user: { id: 'owner-id' } } as never,
        'album-id',
        ['asset-id'],
        true,
      ),
    ).resolves.toEqual([{ id: 'asset-id', success: true, error: undefined }]);
    expect(updateAssets).toHaveBeenCalledOnce();
  });
});

describe('AlbumService.processingStatus', () => {
  it('reports preview progress across the complete album', async () => {
    const count = vi.fn()
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);
    const service = new AlbumService(
      { albumAsset: { count } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'getAccess').mockResolvedValue('owner');

    await expect(
      service.processingStatus({ user: { id: 'owner-id' } } as never, 'album-id'),
    ).resolves.toEqual({
      total: 7,
      ready: 5,
      pending: 2,
      progressTotal: 10,
      progressReady: 8,
      previewsPending: 1,
      videosPending: 1,
    });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: {
        albumId: 'album-id',
        asset: expect.objectContaining({ thumbnailPath: { not: null } }),
      },
    });
  });
});

describe('AlbumService Trash lifecycle', () => {
  it('moves selected owned media to Trash while preserving album membership', async () => {
    const moveToTrash = vi.fn().mockResolvedValue({ trashed: 1, assetIds: ['photo-id'] });
    const deleteMany = vi.fn();
    const service = new AlbumService(
      {
        album: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ thumbnailAssetId: null }),
        },
        albumAsset: {
          findMany: vi.fn().mockResolvedValue([{ assetId: 'photo-id' }]),
          deleteMany,
        },
        asset: { findMany: vi.fn().mockResolvedValue([{ id: 'photo-id' }]) },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      { moveToTrash } as never,
    );
    vi.spyOn(service, 'getAccess').mockResolvedValue('owner');

    await expect(
      service.removeAssets(
        { user: { id: 'owner-id' } } as never,
        'album-id',
        ['photo-id'],
      ),
    ).resolves.toEqual([
      { id: 'photo-id', success: true, error: undefined, trashed: true },
    ]);
    expect(moveToTrash).toHaveBeenCalledWith('owner-id', ['photo-id']);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('moves the album and every live photo inside it to the same Trash batch', async () => {
    const updateAssets = vi.fn().mockResolvedValue({ count: 2 });
    const updateAlbum = vi.fn().mockResolvedValue({});
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stopProcessing = vi.fn().mockResolvedValue({ removedJobs: 0 });
    const transaction = {
      albumAsset: {
        findMany: vi.fn().mockResolvedValue([{ assetId: 'photo-1' }, { assetId: 'photo-2' }]),
      },
      asset: { updateMany: updateAssets },
      album: { update: updateAlbum },
    };
    const service = new AlbumService(
      { $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) => work(transaction)) } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        refreshThumbnailsForAssets: refresh,
        stopProcessingForAssets: stopProcessing,
      } as never,
    );
    vi.spyOn(service, 'getAccess').mockResolvedValue('owner');

    await expect(
      service.remove({ user: { id: 'owner-id' } } as never, 'album-id'),
    ).resolves.toEqual({ successful: true, trashedAssets: 2 });
    const deletedAt = updateAlbum.mock.calls[0][0].data.deletedAt as Date;
    expect(updateAssets).toHaveBeenCalledWith({
      where: { id: { in: ['photo-1', 'photo-2'] }, ownerId: 'owner-id', deletedAt: null },
      data: { deletedAt, status: 'TRASHED' },
    });
    expect(refresh).toHaveBeenCalledWith(['photo-1', 'photo-2']);
    expect(stopProcessing).toHaveBeenCalledWith('owner-id', ['photo-1', 'photo-2']);
  });

  it('permanently removes only photos from the album Trash batch', async () => {
    const deletedAt = new Date('2026-08-14T10:00:00Z');
    const deletePermanently = vi.fn().mockResolvedValue({ deleted: 1, freedBytes: 42n });
    const deleteAlbum = vi.fn().mockResolvedValue({});
    const prisma = {
      album: {
        findFirst: vi.fn().mockResolvedValue({ id: 'album-id', deletedAt }),
        delete: deleteAlbum,
      },
      albumAsset: {
        findMany: vi.fn().mockResolvedValue([{ assetId: 'photo-id' }]),
      },
    };
    const service = new AlbumService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { deletePermanently } as never,
    );

    await expect(service.deletePermanently('owner-id', 'album-id')).resolves.toEqual({
      deleted: 1,
      deletedAssets: 1,
    });
    expect(prisma.albumAsset.findMany).toHaveBeenCalledWith({
      where: { albumId: 'album-id', asset: { ownerId: 'owner-id', deletedAt } },
      select: { assetId: true },
    });
    expect(deletePermanently).toHaveBeenCalledWith('owner-id', ['photo-id']);
    expect(deleteAlbum).toHaveBeenCalledWith({ where: { id: 'album-id' } });
  });
});
