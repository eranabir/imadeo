import { describe, expect, it, vi } from 'vitest';
import { AssetService } from './asset.service';

function createService(existing: Record<string, unknown>) {
  const assetUpdate = vi.fn().mockResolvedValue({ id: existing.id });
  const storageRemove = vi.fn().mockResolvedValue(undefined);
  const ensurePath = vi.fn().mockResolvedValue({ id: 'new-folder' });
  const refreshThumbnails = vi.fn().mockResolvedValue(undefined);
  const assertQuota = vi.fn();
  const service = new AssetService(
    { asset: { findFirst: vi.fn().mockResolvedValue(existing), update: assetUpdate } } as never,
    { remove: storageRemove } as never,
    {} as never,
    { ensurePath, getById: vi.fn() } as never,
    { refreshThumbnailsForAssets: refreshThumbnails } as never,
    { assertQuota } as never,
    {} as never,
    {} as never,
  );
  Object.defineProperty(service, 'hashFile', {
    value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  });
  return { service, assetUpdate, storageRemove, ensurePath, refreshThumbnails, assertQuota };
}

describe('AssetService duplicate upload destinations', () => {
  const upload = {
    path: '/tmp/re-upload.jpg',
    originalname: 're-upload.jpg',
    mimetype: 'image/jpeg',
    size: 100,
  };

  it('restores a trashed asset into the rebuilt directory destination', async () => {
    const test = createService({
      id: 'asset-id',
      deletedAt: new Date(),
      folderId: 'deleted-folder',
      folder: { deletedAt: new Date() },
    });

    await expect(
      test.service.createFromUpload('owner-id', upload, {
        relativePath: '2010/re-upload.jpg',
        folderId: 'parent-folder',
      }),
    ).resolves.toEqual({ id: 'asset-id', status: 'restored' });
    expect(test.ensurePath).toHaveBeenCalledWith('owner-id', ['2010'], 'parent-folder');
    expect(test.assetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-id' },
      data: {
        deletedAt: null,
        status: 'ACTIVE',
        folderId: 'new-folder',
      },
    });
    expect(test.refreshThumbnails).toHaveBeenCalledWith(['asset-id']);
    expect(test.assertQuota).not.toHaveBeenCalled();
  });

  it('repairs an active asset left under a deleted folder on the next retry', async () => {
    const test = createService({
      id: 'asset-id',
      deletedAt: null,
      folderId: 'deleted-folder',
      folder: { deletedAt: new Date() },
    });

    await expect(
      test.service.createFromUpload('owner-id', upload, {
        relativePath: '2010/re-upload.jpg',
        folderId: 'parent-folder',
      }),
    ).resolves.toEqual({ id: 'asset-id', status: 'organized' });
    expect(test.assetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-id' },
      data: {
        deletedAt: null,
        status: 'ACTIVE',
        folderId: 'new-folder',
      },
    });
    expect(test.refreshThumbnails).not.toHaveBeenCalled();
  });
});

describe('AssetService.listTrash', () => {
  it('lists only photos deleted directly, not photos represented by a deleted folder', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new AssetService(
      { asset: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { get: vi.fn().mockReturnValue(30) } as never,
    );

    await service.listTrash('owner-id');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        ownerId: 'owner-id',
        deletedAt: { not: null },
        OR: [{ folderId: null }, { folder: { deletedAt: null } }],
      },
      include: { exif: true },
      orderBy: { deletedAt: 'desc' },
      skip: 0,
      take: 250,
    });
  });
});
