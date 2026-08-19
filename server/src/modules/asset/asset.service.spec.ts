import { ConflictException, NotFoundException } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { AssetService } from './asset.service';

function createService(existing: Record<string, unknown>) {
  const assetFindFirst = vi.fn().mockResolvedValue(existing);
  const assetUpdate = vi.fn().mockResolvedValue({ id: existing.id });
  const assetUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
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
      asset: {
        findFirst: assetFindFirst,
        findMany: vi.fn().mockResolvedValue([]),
        update: assetUpdate,
        updateMany: assetUpdateMany,
      },
      album: { findFirst: albumFindFirst, update: albumUpdate },
      albumAsset: { createMany: albumAssetCreateMany },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    } as never,
    {
      remove: storageRemove,
      move: vi.fn().mockResolvedValue('/data/thumbs/asset-id-browser.jpg'),
      buildBrowserThumbnailPath: vi.fn().mockReturnValue('/data/thumbs/asset-id-browser.jpg'),
    } as never,
    {
      releaseJobIds: vi.fn().mockResolvedValue(0),
      enqueueMany: vi.fn().mockResolvedValue(undefined),
    } as never,
    { ensurePath, getById: vi.fn() } as never,
    { register: registerDevice, recordAsset: recordDeviceAsset } as never,
    { refreshThumbnailsForAssets: refreshThumbnails } as never,
    { assertQuota } as never,
    {} as never,
    { get: vi.fn().mockReturnValue(false) } as never,
    { refreshThumbnailsForAssets: refreshThumbnails } as never,
  );
  Object.defineProperty(service, 'hashFile', {
    value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  });
  return {
    service,
    assetFindFirst,
    assetUpdate,
    assetUpdateMany,
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

describe('AssetService browser thumbnail', () => {
  it('validates and stores a provisional JPEG without completing canonical processing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'imadeo-browser-thumbnail-'));
    const path = join(directory, 'preview.jpg');
    await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#123456' },
    }).jpeg().toFile(path);
    const test = createService({ id: 'asset-id', thumbnailPath: null });

    try {
      await expect(test.service.storeBrowserThumbnail('owner-id', 'asset-id', {
        path,
        originalname: 'browser-preview.jpg',
        mimetype: 'image/jpeg',
        size: 300,
      })).resolves.toEqual({ stored: true, canonicalReady: false });
      expect(test.assetUpdateMany).toHaveBeenCalledWith({
        where: {
          id: 'asset-id',
          ownerId: 'owner-id',
          deletedAt: null,
          thumbnailPath: null,
        },
        data: { thumbnailPath: '/data/thumbs/asset-id-browser.jpg' },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('AssetService library filters', () => {
  it('finds media that belongs to neither a folder nor an album', () => {
    const { service } = createService({ id: 'asset-id' });

    const where = service.buildWhere('owner-id', {
      notInFolder: true,
      notInAlbum: true,
    });

    expect(where).toEqual({
      AND: [
        { ownerId: 'owner-id' },
        expect.objectContaining({
          folderId: null,
          albums: { none: {} },
        }),
      ],
    });
  });
});

describe('AssetService media rename', () => {
  it('keeps the original extension when a client requests another one', async () => {
    const test = createService({ id: 'asset-id', originalFileName: 'IMG_0303.HEIC' });

    await test.service.update('owner-id', 'asset-id', { originalFileName: 'Summer photo.jpg' });

    expect(test.assetUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'asset-id' },
      data: expect.objectContaining({ originalFileName: 'Summer photo.HEIC' }),
    }));
  });

  it('allows dots in the base name when the unchanged extension is supplied', async () => {
    const test = createService({ id: 'asset-id', originalFileName: 'clip.MOV' });

    await test.service.update('owner-id', 'asset-id', { originalFileName: 'Trip.final.MOV' });

    expect(test.assetUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'asset-id' },
      data: expect.objectContaining({ originalFileName: 'Trip.final.MOV' }),
    }));
  });
});

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

  it('uses the receipt to make a deliberate duplicate retry idempotent', async () => {
    const test = createService({
      id: 'asset-id',
      deletedAt: null,
      folder: null,
    });

    await expect(
      test.service.createFromUpload('owner-id', upload, {
        uploadId: 'duplicate-request-id',
      }),
    ).resolves.toEqual({ id: 'asset-id', status: 'confirmed' });
    expect(test.storageRemove).toHaveBeenCalledWith('/tmp/re-upload.jpg');
    expect(test.assertQuota).not.toHaveBeenCalled();
  });

  it('reuses a matching trashed copy for a fresh web upload receipt', async () => {
    const deleted = {
      id: 'asset-id',
      deletedAt: new Date(),
      folderId: 'deleted-folder',
      folder: { deletedAt: new Date() },
    };
    const test = createService(deleted);
    test.assetFindFirst.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(deleted);

    await expect(
      test.service.createFromUpload('owner-id', upload, {
        uploadId: 'fresh-upload-id',
        relativePath: '2010/re-upload.jpg',
        folderId: 'parent-folder',
      }),
    ).resolves.toEqual({ id: 'asset-id', status: 'restored' });
    expect(test.assetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-id' },
      data: {
        deletedAt: null,
        status: 'ACTIVE',
        uploadId: 'fresh-upload-id',
        uploadBatchId: null,
        folderId: 'new-folder',
      },
    });
    expect(test.assertQuota).not.toHaveBeenCalled();
  });

  it('rejects remaining requests after their destination folder enters Trash', async () => {
    const test = createService({ id: 'old-asset', folder: { deletedAt: new Date() } });

    await expect(
      test.service.createFromUpload('owner-id', upload, {
        uploadId: 'late-upload-id',
        uploadBatchId: 'interrupted-batch',
        relativePath: '2010/re-upload.jpg',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(test.storageRemove).toHaveBeenCalledWith('/tmp/re-upload.jpg');
    expect(test.ensurePath).not.toHaveBeenCalled();
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

describe('AssetService deferred upload processing', () => {
  it('stores each new web receipt as a copy without starting backend processing', async () => {
    const assetId = '2d32251a-2616-4a23-ac3a-e0f5026a9019';
    const findFirst = vi.fn().mockResolvedValue(null);
    const findMany = vi.fn().mockResolvedValue([{ id: assetId }]);
    const onAssetUploaded = vi.fn();
    const releaseJobIds = vi.fn().mockResolvedValue(0);
    const enqueueMany = vi.fn().mockResolvedValue(undefined);
    const service = new AssetService(
      {
        asset: {
          findFirst,
          findMany,
          create: vi.fn().mockResolvedValue({ id: assetId, originalFileName: 'photo.jpg' }),
          update: vi.fn().mockResolvedValue({ id: assetId }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          delete: vi.fn(),
        },
        user: { update: vi.fn().mockResolvedValue({}) },
        recognitionBatch: { upsert: vi.fn().mockResolvedValue({}) },
      } as never,
      {
        buildOriginalPath: vi.fn().mockReturnValue('/data/photo.jpg'),
        move: vi.fn().mockResolvedValue('/data/photo.jpg'),
        remove: vi.fn(),
      } as never,
      { onAssetUploaded, releaseJobIds, enqueueMany } as never,
      { getById: vi.fn() } as never,
      { register: vi.fn().mockResolvedValue(null) } as never,
      { refreshThumbnailsForAssets: vi.fn() } as never,
      { assertQuota: vi.fn() } as never,
      { refreshThumbnailsForAssets: vi.fn() } as never,
      {} as never,
      {} as never,
    );
    Object.defineProperty(service, 'hashFile', {
      value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    });

    await expect(
      service.createFromUpload(
        'owner-id',
        { path: '/tmp/photo.jpg', originalname: 'photo.jpg', mimetype: 'image/jpeg', size: 5 },
        { uploadId: 'upload-id', uploadBatchId: 'batch-id', deferProcessing: true },
      ),
    ).resolves.toEqual({ id: assetId, status: 'created' });
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { ownerId: 'owner-id', OR: [{ uploadId: 'upload-id' }, {
        uploadBatchId: 'batch-id',
        folder: { deletedAt: { not: null } },
      }] },
      select: { id: true, folder: { select: { deletedAt: true } } },
    });
    expect(onAssetUploaded).not.toHaveBeenCalled();
    expect(enqueueMany).not.toHaveBeenCalled();

    await service.completeUploadBatch('owner-id', 'batch-id', [assetId]);
    expect(enqueueMany).toHaveBeenCalledWith(
      'metadata',
      'extract-metadata',
      [{ assetId }],
    );
  });

  it('queues stored files only after the web batch completes', async () => {
    const assets = [
      { id: 'asset-a', type: 'VIDEO', uploadId: 'upload-a', deletedAt: null, folder: null, jobStatus: null },
      { id: 'asset-b', type: 'IMAGE', uploadId: 'upload-b', deletedAt: null, folder: null, jobStatus: null },
    ];
    const findMany = vi.fn().mockResolvedValue(assets);
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const upsertBatch = vi.fn().mockResolvedValue({});
    const releaseJobIds = vi.fn().mockResolvedValue(0);
    const enqueueMany = vi.fn().mockResolvedValue(undefined);
    const service = new AssetService(
      {
        asset: { findMany, updateMany },
        recognitionBatch: { upsert: upsertBatch },
      } as never,
      {} as never,
      { releaseJobIds, enqueueMany } as never,
      {} as never,
      {} as never,
      {} as never,
      { refreshThumbnailsForAssets: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.checkUploadReceipts('owner-id', ['upload-a', 'upload-b'], {
      batchId: 'batch-id',
      deferProcessing: true,
    });
    expect(enqueueMany).not.toHaveBeenCalled();

    await expect(
      service.completeUploadBatch('owner-id', 'batch-id', ['asset-a', 'asset-b']),
    ).resolves.toEqual({ stored: 2, queued: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['asset-a', 'asset-b'] }, ownerId: 'owner-id' },
      data: { uploadBatchId: 'batch-id' },
    });
    expect(upsertBatch).toHaveBeenCalledWith({
      where: { ownerId_id: { ownerId: 'owner-id', id: 'batch-id' } },
      create: { ownerId: 'owner-id', id: 'batch-id' },
      update: { completedAt: null },
    });
    expect(releaseJobIds).toHaveBeenCalledWith(
      'metadata',
      'extract-metadata',
      ['asset-b', 'asset-a'],
    );
    expect(enqueueMany).toHaveBeenCalledWith(
      'metadata',
      'extract-metadata',
      [{ assetId: 'asset-b' }, { assetId: 'asset-a' }],
    );
  });

  it('never queues another account assets supplied to batch completion', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const enqueueMany = vi.fn();
    const service = new AssetService(
      {
        asset: { findMany, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
        recognitionBatch: { upsert: vi.fn().mockResolvedValue({}) },
      } as never,
      {} as never,
      { releaseJobIds: vi.fn(), enqueueMany } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.completeUploadBatch('owner-id', 'batch-id', ['other-account-asset']),
    ).resolves.toEqual({ stored: 1, queued: 0 });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['other-account-asset'] },
        ownerId: 'owner-id',
        deletedAt: null,
        OR: [{ jobStatus: null }, { jobStatus: { metadataExtractedAt: null } }],
      },
      select: { id: true, type: true },
    });
    expect(enqueueMany).not.toHaveBeenCalled();
  });
});

describe('AssetService Live Photo recovery', () => {
  it('reveals every formerly hidden motion file and removes obsolete pairing', async () => {
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
      },
      select: {
        id: true,
        isDeviceOnly: true,
        previewPath: true,
        jobStatus: { select: { metadataExtractedAt: true, thumbnailAt: true } },
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { livePhotoVideoId: { in: ['video-id'] } },
      data: { livePhotoVideoId: null },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
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

describe('AssetService thumbnail readiness', () => {
  it('returns all ready ids in one query without requesting thumbnail files', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'ready-id', thumbnailPath: '/data/thumb.jpg' },
      { id: 'pending-id', thumbnailPath: null },
    ]);
    const service = new AssetService(
      { asset: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.thumbnailStatus('owner-id', ['ready-id', 'pending-id', 'ready-id']),
    ).resolves.toEqual({ readyIds: ['ready-id'] });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['ready-id', 'pending-id'] },
        ownerId: 'owner-id',
        deletedAt: null,
      },
      select: { id: true, thumbnailPath: true },
    });
  });
});

describe('AssetService Live Photo Trash lifecycle', () => {
  it('moves a visible still and its hidden motion clip to Trash together', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const cancelAssetProcessing = vi.fn().mockResolvedValue(0);
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
      { cancelAssetProcessing } as never,
      {} as never,
      {} as never,
      { refreshThumbnailsForAssets: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      { refreshThumbnailsForAssets: vi.fn() } as never,
    );

    await expect(service.trash('owner-id', ['still-id'])).resolves.toEqual({
      trashed: 2,
      removedShares: 0,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['still-id', 'video-id'] } },
      data: { deletedAt: expect.any(Date), status: 'TRASHED' },
    });
    expect(cancelAssetProcessing).toHaveBeenCalledWith(['still-id', 'video-id']);
  });

  it('resumes the first incomplete processing stage when an asset is restored', async () => {
    const releaseJobIds = vi.fn().mockResolvedValue(0);
    const enqueueMany = vi.fn().mockResolvedValue(undefined);
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'asset-id', livePhotoVideoId: null, folderId: null, folder: null },
      ])
      .mockResolvedValueOnce([
        {
          id: 'asset-id',
          type: 'IMAGE',
          visibility: 'TIMELINE',
          jobStatus: { metadataExtractedAt: new Date(), thumbnailAt: null },
        },
      ]);
    const service = new AssetService(
      {
        asset: { findMany, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      } as never,
      {} as never,
      { releaseJobIds, enqueueMany } as never,
      {} as never,
      {} as never,
      { refreshThumbnailsForAssets: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      { faceRecognitionEnabled: false } as never,
      { get: vi.fn().mockReturnValue(false) } as never,
      { refreshThumbnailsForAssets: vi.fn() } as never,
    );

    await expect(service.restore('owner-id', ['asset-id'])).resolves.toEqual({ restored: 1 });
    expect(releaseJobIds).toHaveBeenCalledWith(
      'thumbnail',
      'generate-thumbnails',
      ['asset-id'],
    );
    expect(enqueueMany).toHaveBeenCalledWith(
      'thumbnail',
      'generate-thumbnails',
      [{ assetId: 'asset-id' }],
    );
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
