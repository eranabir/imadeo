import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FolderService } from './folder.service';

function serviceWith(transaction: Record<string, unknown>) {
  const prisma = {
    $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) => work(transaction)),
  } as unknown as PrismaService;
  return new FolderService(prisma, {
    refreshThumbnailsForAssets: vi.fn(),
    deletePermanently: vi.fn(),
  } as never);
}

describe('FolderService.convertToAlbum', () => {
  it('atomically replaces a leaf folder and preserves all direct photos', async () => {
    const folderFindFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'folder-id',
        ownerId: 'owner-id',
        parentId: 'parent-id',
        name: 'Summer',
        isLocked: true,
      })
      .mockResolvedValueOnce(null);
    const albumCreate = vi.fn().mockResolvedValue({
      id: 'album-id',
      ownerId: 'owner-id',
      folderId: 'parent-id',
      name: 'Summer',
      isLocked: true,
    });
    const assetUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const albumAssetCreateMany = vi.fn().mockResolvedValue({ count: 2 });
    const folderDelete = vi.fn().mockResolvedValue({ id: 'folder-id' });
    const service = serviceWith({
      folder: { findFirst: folderFindFirst, delete: folderDelete },
      album: { findFirst: vi.fn().mockResolvedValue(null), create: albumCreate },
      albumAsset: { createMany: albumAssetCreateMany },
      folderUser: { findFirst: vi.fn().mockResolvedValue(null) },
      asset: {
        findMany: vi.fn().mockResolvedValue([{ id: 'photo-1' }, { id: 'photo-2' }]),
        updateMany: assetUpdateMany,
      },
    });

    await expect(service.convertToAlbum('owner-id', 'folder-id')).resolves.toMatchObject({
      id: 'album-id',
      assetCount: 2,
    });
    expect(albumCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: 'owner-id',
        folderId: 'parent-id',
        name: 'Summer',
        isLocked: true,
      }),
    });
    expect(albumAssetCreateMany).toHaveBeenCalledWith({
      data: [
        { albumId: 'album-id', assetId: 'photo-1', addedById: 'owner-id' },
        { albumId: 'album-id', assetId: 'photo-2', addedById: 'owner-id' },
      ],
    });
    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: { ownerId: 'owner-id', folderId: 'folder-id' },
      data: { folderId: null },
    });
    expect(folderDelete).toHaveBeenCalledWith({
      where: { id: 'folder-id' },
    });
  });

  it('writes large album membership in bounded batches', async () => {
    const assets = Array.from({ length: 1_001 }, (_, index) => ({ id: `photo-${index}` }));
    const createMany = vi.fn().mockResolvedValue({ count: 1_000 });
    const service = serviceWith({
      folder: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'folder-id',
            ownerId: 'owner-id',
            parentId: null,
            name: 'Archive',
            isLocked: false,
          })
          .mockResolvedValueOnce(null),
        delete: vi.fn().mockResolvedValue({ id: 'folder-id' }),
      },
      album: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'album-id' }),
      },
      albumAsset: { createMany },
      folderUser: { findFirst: vi.fn().mockResolvedValue(null) },
      asset: {
        findMany: vi.fn().mockResolvedValue(assets),
        updateMany: vi.fn().mockResolvedValue({ count: assets.length }),
      },
    });

    await service.convertToAlbum('owner-id', 'folder-id');

    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[0][0].data).toHaveLength(1_000);
    expect(createMany.mock.calls[1][0].data).toHaveLength(1);
  });

  it('does not convert a folder that contains structural children', async () => {
    const albumCreate = vi.fn();
    const service = serviceWith({
      folder: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'folder-id', ownerId: 'owner-id' })
          .mockResolvedValueOnce({ id: 'child-id' }),
        update: vi.fn(),
      },
      album: { findFirst: vi.fn().mockResolvedValue(null), create: albumCreate },
      folderUser: { findFirst: vi.fn().mockResolvedValue(null) },
      asset: { findMany: vi.fn(), updateMany: vi.fn() },
    });

    await expect(service.convertToAlbum('owner-id', 'folder-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(albumCreate).not.toHaveBeenCalled();
  });

  it('does not convert an empty folder', async () => {
    const albumCreate = vi.fn();
    const service = serviceWith({
      folder: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'folder-id', ownerId: 'owner-id' })
          .mockResolvedValueOnce(null),
        update: vi.fn(),
      },
      album: { findFirst: vi.fn().mockResolvedValue(null), create: albumCreate },
      folderUser: { findFirst: vi.fn().mockResolvedValue(null) },
      asset: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    });

    await expect(service.convertToAlbum('owner-id', 'folder-id')).rejects.toThrow(
      'Only a folder containing photos can be converted to an album',
    );
    expect(albumCreate).not.toHaveBeenCalled();
  });
});

describe('FolderService.getContents', () => {
  it('returns only media outside both folders and albums at the Browse root', async () => {
    const findAssets = vi.fn().mockResolvedValue([]);
    const countAssets = vi.fn().mockResolvedValue(0);
    const service = new FolderService(
      {
        folder: { findMany: vi.fn().mockResolvedValue([]) },
        album: { findMany: vi.fn().mockResolvedValue([]) },
        asset: { findMany: findAssets, count: countAssets },
      } as never,
      {} as never,
    );

    await service.getContents('owner-id', null);

    const rootWhere = expect.objectContaining({
      ownerId: 'owner-id',
      folderId: null,
      albums: { none: {} },
    });
    expect(findAssets).toHaveBeenCalledWith(expect.objectContaining({ where: rootWhere }));
    expect(countAssets).toHaveBeenCalledWith({ where: rootWhere });
  });
});

describe('FolderService.create', () => {
  it('creates a separate active folder while the old one remains in Trash', async () => {
    const createdFolder = {
      id: 'new-folder',
      ownerId: 'owner-id',
      parentId: null,
      path: '/',
      depth: 0,
      name: '2010',
      deletedAt: null,
    };
    const create = vi.fn().mockResolvedValue(createdFolder);
    const update = vi.fn().mockResolvedValue({
      ...createdFolder,
      path: '/new-folder/',
    });
    const prisma = {
      folder: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (work: (tx: unknown) => unknown) =>
        work({ folder: { create, update } }),
      ),
    } as unknown as PrismaService;
    const service = new FolderService(prisma, {} as never);

    await expect(service.create('owner-id', { name: '2010' })).resolves.toMatchObject({
      id: 'new-folder',
      deletedAt: null,
      path: '/new-folder/',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId: 'owner-id', parentId: null, name: '2010' }),
    });
  });
});

describe('FolderService Trash round-trip', () => {
  it('refuses to restore a folder beside an active folder with the same name', async () => {
    const deletedAt = new Date('2026-08-14T00:00:00Z');
    const deletedFolder = {
      id: 'deleted-folder',
      ownerId: 'owner-id',
      parentId: null,
      path: '/deleted-folder/',
      depth: 0,
      name: 'Birthdays',
      deletedAt,
    };
    const transaction = vi.fn();
    const prisma = {
      folder: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(deletedFolder)
          .mockResolvedValueOnce({ id: 'active-folder' }),
        findMany: vi.fn().mockResolvedValue([deletedFolder]),
      },
      album: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: transaction,
    } as unknown as PrismaService;
    const service = new FolderService(prisma, {} as never);

    const restoring = service.restore('owner-id', deletedFolder.id);
    await expect(restoring).rejects.toBeInstanceOf(ConflictException);
    await expect(restoring).rejects.toThrow(
      'A folder named “Birthdays” already exists here',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('keeps album and photo folder links so the complete tree can be restored', async () => {
    const albumUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const assetUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const folderUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      folder: {
        findMany: vi.fn().mockResolvedValue([{ id: 'folder-id' }]),
        updateMany: folderUpdateMany,
      },
      album: {
        findMany: vi.fn().mockResolvedValue([{ id: 'album-id' }]),
        updateMany: albumUpdateMany,
      },
      asset: {
        findMany: vi.fn().mockResolvedValue([{ id: 'photo-1' }, { id: 'photo-2' }]),
        updateMany: assetUpdateMany,
      },
    };
    const prisma = {
      folder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'folder-id',
          ownerId: 'owner-id',
          path: '/folder-id/',
        }),
      },
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) => work(transaction)),
    } as unknown as PrismaService;
    const service = new FolderService(prisma, {
      refreshThumbnailsForAssets: vi.fn(),
      deletePermanently: vi.fn(),
    } as never);

    await service.remove('owner-id', 'folder-id');

    expect(albumUpdateMany).toHaveBeenCalledWith({
      where: { ownerId: 'owner-id', folderId: { in: ['folder-id'] }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: {
        ownerId: 'owner-id',
        deletedAt: null,
        OR: [
          { folderId: { in: ['folder-id'] } },
          { albums: { some: { albumId: { in: ['album-id'] } } } },
        ],
      },
      data: { deletedAt: expect.any(Date), status: 'TRASHED' },
    });
    expect(folderUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['folder-id'] } },
      data: { deletedAt: expect.any(Date) },
    });
  });
});

describe('FolderService.getAssetIds', () => {
  it('returns every live photo directly inside the owned folder', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'photo-2' }, { id: 'photo-1' }]);
    const prisma = {
      folder: {
        findFirst: vi.fn().mockResolvedValue({ id: 'folder-id', ownerId: 'owner-id' }),
      },
      asset: { findMany },
    } as unknown as PrismaService;
    const service = new FolderService(prisma, {
      refreshThumbnailsForAssets: vi.fn(),
      deletePermanently: vi.fn(),
    } as never);

    await expect(service.getAssetIds('owner-id', 'folder-id')).resolves.toEqual({
      ids: ['photo-2', 'photo-1'],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        ownerId: 'owner-id',
        folderId: 'folder-id',
        deletedAt: null,
        isDeviceOnly: false,
        visibility: { in: ['TIMELINE', 'ARCHIVE'] },
      },
      select: { id: true },
      orderBy: [{ localDateTime: 'desc' }, { id: 'desc' }],
    });
  });
});

describe('FolderService.processingStatus', () => {
  it('reports how many previews remain for the complete folder', async () => {
    const count = vi.fn()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const prisma = {
      folder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'folder-id',
          ownerId: 'owner-id',
          path: '/folder-id/',
          isLocked: false,
        }),
      },
      asset: { count },
    } as unknown as PrismaService;
    const service = new FolderService(prisma, {} as never);

    await expect(service.processingStatus('owner-id', 'folder-id')).resolves.toEqual({
      total: 5,
      ready: 3,
      pending: 2,
      progressTotal: 7,
      progressReady: 5,
      previewsPending: 1,
      videosPending: 1,
    });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        ownerId: 'owner-id',
        folder: { deletedAt: null, path: { startsWith: '/folder-id/' } },
        thumbnailPath: { not: null },
      }),
    });
  });
});

describe('FolderService.ensurePath', () => {
  it('uses a folder created concurrently by another upload', async () => {
    const concurrent = {
      id: 'shared-folder',
      ownerId: 'owner-id',
      parentId: null,
      name: 'Holiday',
    };
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrent);
    const service = new FolderService(
      { folder: { findFirst } } as never,
      {} as never,
    );
    vi.spyOn(service, 'create').mockRejectedValue(new Error('unique constraint'));

    await expect(service.ensurePath('owner-id', ['Holiday'])).resolves.toEqual(concurrent);
    expect(findFirst).toHaveBeenLastCalledWith({
      where: { ownerId: 'owner-id', parentId: null, name: 'Holiday', deletedAt: null },
    });
  });
});
