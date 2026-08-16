import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AssetService } from './asset.service';

function createService(existing: Record<string, unknown>) {
  const assetUpdate = vi.fn().mockResolvedValue({ id: existing.id });
  const albumFindFirst = vi.fn().mockResolvedValue({ id: 'album-id' });
  const albumAssetCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const albumUpdate = vi.fn().mockResolvedValue({ id: 'album-id' });
  const storageRemove = vi.fn().mockResolvedValue(undefined);
  const ensurePath = vi.fn().mockResolvedValue({ id: 'new-folder' });
  const refreshThumbnails = vi.fn().mockResolvedValue(undefined);
  const assertQuota = vi.fn();
  const registerDevice = vi.fn().mockResolvedValue(null);
  const recordDeviceAsset = vi.fn().mockResolvedValue(undefined);
  const service = new AssetService(
    {
      asset: { findFirst: vi.fn().mockResolvedValue(existing), update: assetUpdate },
      album: { findFirst: albumFindFirst, update: albumUpdate },
      albumAsset: { createMany: albumAssetCreateMany },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    } as never,
    { remove: storageRemove } as never,
    {} as never,
    { ensurePath, getById: vi.fn() } as never,
    { register: registerDevice, recordAsset: recordDeviceAsset } as never,
    { refreshThumbnailsForAssets: refreshThumbnails } as never,
    { assertQuota } as never,
    {} as never,
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
    albumFindFirst,
    albumAssetCreateMany,
    albumUpdate,
  };
}

describe('AssetService duplicate upload destinations', () => {
  const upload = {
    path: '/tmp/re-upload.jpg',
    originalname: 're-upload.jpg',
    mimetype: 'image/jpeg',
    size: 100,
  };

  it('confirms a committed upload receipt without ingesting the retry again', async () => {
    const test = createService({
      id: 'asset-id',
      deletedAt: null,
      folder: null,
    });

    await expect(
      test.service.createFromUpload('owner-id', upload, { uploadId: 'web-upload-1' }),
    ).resolves.toEqual({ id: 'asset-id', status: 'confirmed' });
    expect(test.storageRemove).toHaveBeenCalledWith('/tmp/re-upload.jpg');
    expect(test.registerDevice).not.toHaveBeenCalled();
    expect(test.assertQuota).not.toHaveBeenCalled();
  });

  it('confirms a committed upload only after restoring its requested album membership', async () => {
    const test = createService({
      id: 'asset-id',
      deletedAt: null,
      folder: null,
    });

    await expect(
      test.service.createFromUpload('owner-id', upload, {
        uploadId: 'web-upload-1',
        albumId: 'album-id',
      }),
    ).resolves.toEqual({ id: 'asset-id', status: 'confirmed' });
    expect(test.albumFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'album-id',
        deletedAt: null,
        OR: [
          { ownerId: 'owner-id' },
          { albumUsers: { some: { userId: 'owner-id', role: 'EDITOR' } } },
        ],
      },
      select: { id: true },
    });
    expect(test.albumAssetCreateMany).toHaveBeenCalledWith({
      data: [{ albumId: 'album-id', assetId: 'asset-id', addedById: 'owner-id' }],
      skipDuplicates: true,
    });
    expect(test.albumUpdate).toHaveBeenCalledWith({
      where: { id: 'album-id' },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('does not report a receipt as successful when its album membership cannot be written', async () => {
    const test = createService({
      id: 'asset-id',
      deletedAt: null,
      folder: null,
    });
    test.albumAssetCreateMany.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      test.service.createFromUpload('owner-id', upload, {
        uploadId: 'web-upload-1',
        albumId: 'album-id',
      }),
    ).rejects.toThrow('database unavailable');
  });

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

  it('promotes a device-only asset when the same file is uploaded from the web', async () => {
    const test = createService({
      id: 'asset-id',
      deletedAt: null,
      isDeviceOnly: true,
      folderId: null,
      folder: null,
    });

    await expect(test.service.createFromUpload('owner-id', upload, {})).resolves.toEqual({
      id: 'asset-id',
      status: 'organized',
    });
    expect(test.assetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-id' },
      data: {
        deletedAt: null,
        status: 'ACTIVE',
        isDeviceOnly: false,
        folderId: undefined,
      },
    });
  });

  it('treats lower- and uppercase MOV extensions as videos', () => {
    const { service } = createService({ id: 'asset-id' });
    const detectType = (service as unknown as {
      detectType: (filename: string, mimetype: string) => string;
    }).detectType.bind(service);

    expect(detectType('clip.mov', '')).toBe('VIDEO');
    expect(detectType('clip.MOV', '')).toBe('VIDEO');
  });
});

describe('AssetService Live Photo recovery', () => {
  it('reveals and resumes processing orphaned motion clips on startup', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'video-id',
        isDeviceOnly: false,
        previewPath: '/data/preview.jpg',
        jobStatus: { metadataExtractedAt: new Date(), thumbnailAt: new Date() },
      },
    ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const releaseJobIds = vi.fn().mockResolvedValue(1);
    const enqueueMany = vi.fn().mockResolvedValue(undefined);
    const service = new AssetService(
      { asset: { findMany, updateMany } } as never,
      {} as never,
      { releaseJobIds, enqueueMany } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { faceRecognitionEnabled: true, videoRecognitionEnabled: true } as never,
      {} as never,
      {} as never,
    );

    await service.onModuleInit();

    expect(findMany).toHaveBeenCalledWith({
      where: {
        type: 'VIDEO',
        visibility: 'HIDDEN',
        deletedAt: null,
        livePhotoStill: { none: {} },
      },
      select: {
        id: true,
        isDeviceOnly: true,
        previewPath: true,
        jobStatus: { select: { metadataExtractedAt: true, thumbnailAt: true } },
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['video-id'] }, visibility: 'HIDDEN' },
      data: { visibility: 'TIMELINE' },
    });
    expect(releaseJobIds).toHaveBeenCalledWith(
      'face-detection',
      'detect-faces',
      ['video-id'],
    );
    expect(enqueueMany).toHaveBeenCalledWith(
      'face-detection',
      'detect-faces',
      [{ assetId: 'video-id' }],
      20,
    );
  });
});

describe('AssetService Live Photo Trash lifecycle', () => {
  it('moves a visible still and its hidden motion clip to Trash together', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const service = new AssetService(
      {
        asset: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'still-id', livePhotoVideoId: 'video-id' },
          ]),
          updateMany,
        },
        assetUser: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { refreshThumbnailsForAssets: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.trash('owner-id', ['still-id'])).resolves.toEqual({
      trashed: 2,
      removedShares: 0,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['still-id', 'video-id'] } },
      data: { deletedAt: expect.any(Date), status: 'TRASHED' },
    });
  });
});

describe('AssetService.listTrash', () => {
  it('lists only photos deleted directly, not photos represented by a deleted folder', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const service = new AssetService(
      { asset: { findMany }, $queryRaw: queryRaw } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { get: vi.fn().mockReturnValue(30) } as never,
      {} as never,
    );

    await service.listTrash('owner-id');

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [] }, ownerId: 'owner-id' },
      include: { exif: true },
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
