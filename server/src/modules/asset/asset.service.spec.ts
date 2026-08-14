import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AssetService } from './asset.service';

function createService(existing: Record<string, unknown>) {
  const assetUpdate = vi.fn().mockResolvedValue({ id: existing.id });
  const storageRemove = vi.fn().mockResolvedValue(undefined);
  const ensurePath = vi.fn().mockResolvedValue({ id: 'new-folder' });
  const refreshThumbnails = vi.fn().mockResolvedValue(undefined);
  const assertQuota = vi.fn();
  const registerDevice = vi.fn().mockResolvedValue(null);
  const recordDeviceAsset = vi.fn().mockResolvedValue(undefined);
  const service = new AssetService(
    { asset: { findFirst: vi.fn().mockResolvedValue(existing), update: assetUpdate } } as never,
    { remove: storageRemove } as never,
    {} as never,
    { ensurePath, getById: vi.fn() } as never,
    { register: registerDevice, recordAsset: recordDeviceAsset } as never,
    { refreshThumbnailsForAssets: refreshThumbnails } as never,
    { assertQuota } as never,
    {} as never,
    {} as never,
  );
  Object.defineProperty(service, 'hashFile', {
    value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  });
  return {
    service,
    assetUpdate,
    storageRemove,
    ensurePath,
    refreshThumbnails,
    assertQuota,
    registerDevice,
    recordDeviceAsset,
  };
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

  it('adds duplicate bytes to the library of the device that sent them', async () => {
    const test = createService({
      id: 'asset-id',
      deletedAt: null,
      folderId: null,
      folder: null,
    });
    test.registerDevice.mockResolvedValueOnce({ id: 'device-id' } as never);

    await test.service.createFromUpload('owner-id', upload, {
      deviceId: 'mobile-install-id',
      deviceAssetId: 'ios-library-id',
      deviceName: 'Eran’s iPhone',
      devicePlatform: 'ios',
    });

    expect(test.registerDevice).toHaveBeenCalledWith('owner-id', {
      clientId: 'mobile-install-id',
      assetId: 'ios-library-id',
      name: 'Eran’s iPhone',
      platform: 'ios',
    });
    expect(test.recordDeviceAsset).toHaveBeenCalledWith(
      'device-id',
      'ios-library-id',
      'asset-id',
    );
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

describe('AssetService.resolveMediaPath for Trash', () => {
  const trashedAsset = {
    id: 'asset-id',
    ownerId: 'owner-id',
    folderId: null,
    visibility: 'TIMELINE',
    deletedAt: new Date(),
    type: 'IMAGE',
    thumbnailPath: '/data/thumb.jpg',
    previewPath: '/data/preview.jpg',
    originalPath: '/data/original.jpg',
    encodedVideoPath: null,
  };

  const serviceFor = () =>
    new AssetService(
      { asset: { findUnique: vi.fn().mockResolvedValue(trashedAsset) } } as never,
      { exists: vi.fn().mockResolvedValue(true) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('serves a trashed thumbnail to its owner', async () => {
    await expect(
      serviceFor().resolveMediaPath(
        { user: { id: 'owner-id' } } as never,
        'asset-id',
        'thumbnail',
      ),
    ).resolves.toMatchObject({ path: '/data/thumb.jpg' });
  });

  it('does not serve a trashed thumbnail to another account', async () => {
    await expect(
      serviceFor().resolveMediaPath(
        { user: { id: 'other-id' } } as never,
        'asset-id',
        'thumbnail',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not serve a trashed original', async () => {
    await expect(
      serviceFor().resolveMediaPath(
        { user: { id: 'owner-id' } } as never,
        'asset-id',
        'original',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
