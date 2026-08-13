import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FolderService } from './folder.service';

function serviceWith(transaction: Record<string, unknown>) {
  const prisma = {
    $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) => work(transaction)),
  } as unknown as PrismaService;
  return new FolderService(prisma);
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
    const folderDelete = vi.fn().mockResolvedValue({ id: 'folder-id' });
    const service = serviceWith({
      folder: { findFirst: folderFindFirst, delete: folderDelete },
      album: { findFirst: vi.fn().mockResolvedValue(null), create: albumCreate },
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
        assets: {
          create: [
            { assetId: 'photo-1', addedById: 'owner-id' },
            { assetId: 'photo-2', addedById: 'owner-id' },
          ],
        },
      }),
    });
    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: { ownerId: 'owner-id', folderId: 'folder-id' },
      data: { folderId: null },
    });
    expect(folderDelete).toHaveBeenCalledWith({
      where: { id: 'folder-id' },
    });
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

describe('FolderService.create', () => {
  it('revives a deleted folder when its path is uploaded again', async () => {
    const deletedAt = new Date('2026-08-14T00:00:00Z');
    const deletedFolder = {
      id: 'deleted-folder',
      ownerId: 'owner-id',
      parentId: null,
      path: '/deleted-folder/',
      depth: 0,
      name: '2010',
      deletedAt,
    };
    const folderUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      folder: {
        findFirst: vi.fn().mockResolvedValue(deletedFolder),
        findMany: vi.fn().mockResolvedValue([deletedFolder]),
        updateMany: folderUpdateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...deletedFolder, deletedAt: null }),
      },
      album: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      asset: {
        findMany: vi.fn().mockResolvedValue([{ id: 'photo-id' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    } as unknown as PrismaService;
    const service = new FolderService(prisma);

    await expect(service.create('owner-id', { name: '2010' })).resolves.toMatchObject({
      id: 'deleted-folder',
      deletedAt: null,
      restoredFolders: 1,
      restoredAlbums: 1,
      restoredAssets: 1,
    });
    expect(folderUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['deleted-folder'] }, ownerId: 'owner-id', deletedAt },
      data: { deletedAt: null },
    });
  });
});

describe('FolderService Trash round-trip', () => {
  it('keeps album and photo folder links so the complete tree can be restored', async () => {
    const albumUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const assetUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const folderUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      folder: {
        findMany: vi.fn().mockResolvedValue([{ id: 'folder-id' }]),
        updateMany: folderUpdateMany,
      },
      album: { updateMany: albumUpdateMany },
      asset: { updateMany: assetUpdateMany },
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
    const service = new FolderService(prisma);

    await service.remove('owner-id', 'folder-id');

    expect(albumUpdateMany).toHaveBeenCalledWith({
      where: { ownerId: 'owner-id', folderId: { in: ['folder-id'] }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: {
        ownerId: 'owner-id',
        folderId: { in: ['folder-id'] },
        deletedAt: null,
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
    const service = new FolderService(prisma);

    await expect(service.getAssetIds('owner-id', 'folder-id')).resolves.toEqual({
      ids: ['photo-2', 'photo-1'],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { ownerId: 'owner-id', folderId: 'folder-id', deletedAt: null },
      select: { id: true },
      orderBy: [{ localDateTime: 'desc' }, { id: 'desc' }],
    });
  });
});
