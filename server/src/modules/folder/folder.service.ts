import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetVisibility, Prisma, UserStatus } from '../../db';
import sanitize from 'sanitize-filename';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ALBUM_COVER_INCLUDE, pickCover } from '../album/album.service';
import type {
  CreateFolderDto,
  FolderContentsQueryDto,
  FolderTreeQueryDto,
  UpdateFolderDto,
} from './folder.dto';

/** An album as it appears nested inside the sidebar folder tree. */
export interface FolderTreeAlbum {
  id: string;
  name: string;
  assetCount: number;
  coverAssetId: string | null;
  coverAssetIds: string[];
}

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string;
  /** True when another account shared this folder tree with the caller. */
  shared: boolean;
  path: string;
  depth: number;
  isLocked: boolean;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  assetCount: number;
  albumCount: number;
  /** Populated by `getTree`; empty for leaves. */
  children: FolderNode[];
  /** The albums filed directly in this folder, so the tree shows them in place. */
  albums: FolderTreeAlbum[];
}

/** Shape returned by the raw tree query; COUNT() comes back as bigint. */
interface FlatFolderRow
  extends Omit<FolderNode, 'children' | 'albums' | 'assetCount' | 'albumCount'> {
  assetCount: bigint;
  albumCount: bigint;
}

const MAX_DEPTH = 32;

@Injectable()
export class FolderService {
  constructor(private readonly prisma: PrismaService) {}

  // -- reads ----------------------------------------------------------------

  /**
   * Returns the whole tree for a user in one query, assembled in memory.
   * A library with tens of thousands of folders still round-trips once.
   */
  async getTree(userId: string, query: FolderTreeQueryDto = {}): Promise<FolderNode[]> {
    const lockedFilter = query.includeLocked
      ? Prisma.empty
      : Prisma.sql`AND f."isLocked" = false`;

    const assetCount = query.recursiveCounts
      ? Prisma.sql`(
          SELECT COUNT(*) FROM assets a
          JOIN folders d ON a."folderId" = d.id
          WHERE d."ownerId" = f."ownerId"
            AND d.path LIKE f.path || '%'
            AND a."deletedAt" IS NULL
        )`
      : Prisma.sql`(
          SELECT COUNT(*) FROM assets a
          WHERE a."folderId" = f.id AND a."deletedAt" IS NULL
        )`;

    const rows = await this.prisma.$queryRaw<FlatFolderRow[]>`
      SELECT
        f.id, f.name, f."parentId", f."ownerId", f.path, f.depth, f."isLocked",
        (f."ownerId" <> ${userId}::uuid) AS shared,
        f.color, f.icon, f."sortOrder",
        ${assetCount}::bigint AS "assetCount",
        (SELECT COUNT(*) FROM albums al
          WHERE al."folderId" = f.id AND al."deletedAt" IS NULL)::bigint AS "albumCount"
      FROM folders f
      WHERE f."deletedAt" IS NULL ${lockedFilter}
        -- A recipient never sees vault folders, even when their client asks to
        -- include locked folders for its own Locked view.
        AND (f."ownerId" = ${userId}::uuid OR f."isLocked" = false)
        AND (
          f."ownerId" = ${userId}::uuid
          OR EXISTS (
            SELECT 1
            FROM folder_users fu
            JOIN folders root ON root.id = fu."folderId"
            WHERE fu."userId" = ${userId}::uuid
              AND root."deletedAt" IS NULL
              AND root."isLocked" = false
              AND f.path LIKE root.path || '%'
          )
        )
      ORDER BY f.depth ASC, f."sortOrder" ASC, f.name ASC
    `;

    const nodes = new Map<string, FolderNode>();
    for (const row of rows) {
      nodes.set(row.id, {
        ...row,
        assetCount: Number(row.assetCount),
        albumCount: Number(row.albumCount),
        children: [],
        albums: [],
      });
    }

    // Albums hang off the tree in the folder they are filed under, so the
    // sidebar can show them in place with a cover rather than only as counts.
    const albums = await this.prisma.album.findMany({
      where: {
        deletedAt: null,
        folderId: { in: [...nodes.keys()] },
        ...(query.includeLocked ? {} : { isLocked: false }),
      },
      include: { _count: { select: { assets: true } }, ...ALBUM_COVER_INCLUDE },
      orderBy: { name: 'asc' },
    });

    for (const album of albums) {
      const parent = nodes.get(album.folderId!);
      if (!parent) continue;
      parent.albums.push({
        id: album.id,
        name: album.name,
        assetCount: album._count.assets,
        ...pickCover(album.thumbnailAssetId, album.assets),
      });
    }

    const roots: FolderNode[] = [];
    for (const node of nodes.values()) {
      // Rows are ordered by depth, so a parent is always in the map already —
      // unless it was filtered out (locked), in which case the node is orphaned
      // and deliberately hidden with it.
      if (node.parentId === null || !nodes.has(node.parentId)) {
        roots.push(node);
      } else {
        nodes.get(node.parentId)?.children.push(node);
      }
    }
    return roots;
  }

  async getById(userId: string, id: string) {
    const folder = await this.prisma.folder.findFirst({
      where: { id, deletedAt: null },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId === userId) return { ...folder, shared: false };
    if (folder.isLocked || !(await this.isSharedWith(userId, folder.path))) {
      throw new NotFoundException('Folder not found');
    }
    return { ...folder, shared: true };
  }

  private async getOwnedById(userId: string, id: string) {
    const folder = await this.prisma.folder.findFirst({
      where: { id, ownerId: userId, deletedAt: null },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    return folder;
  }

  private async isSharedWith(userId: string, path: string) {
    const [result] = await this.prisma.$queryRaw<{ allowed: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM folder_users fu
        JOIN folders root ON root.id = fu."folderId"
        WHERE fu."userId" = ${userId}::uuid
          AND root."deletedAt" IS NULL
          AND root."isLocked" = false
          AND ${path}::text LIKE root.path || '%'
      ) AS allowed
    `;
    return result?.allowed ?? false;
  }

  /** Root-to-self chain, used for the header breadcrumb. */
  async getBreadcrumbs(userId: string, id: string) {
    const folder = await this.getById(userId, id);
    let ids = folder.path.split('/').filter(Boolean);
    if (folder.ownerId !== userId) {
      const roots = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT root.id
        FROM folder_users fu
        JOIN folders root ON root.id = fu."folderId"
        WHERE fu."userId" = ${userId}::uuid
          AND root."deletedAt" IS NULL
          AND root."isLocked" = false
          AND ${folder.path}::text LIKE root.path || '%'
        ORDER BY root.depth DESC
        LIMIT 1
      `;
      const at = ids.indexOf(roots[0]?.id ?? '');
      if (at >= 0) ids = ids.slice(at);
    }
    const folders = await this.prisma.folder.findMany({
      where: { id: { in: ids }, ownerId: folder.ownerId },
      select: { id: true, name: true, isLocked: true },
    });
    const byId = new Map(folders.map((f) => [f.id, f]));
    return ids.map((fid) => byId.get(fid)).filter((f): f is NonNullable<typeof f> => Boolean(f));
  }

  /**
   * Everything visible inside one folder: sub-folders, albums and assets.
   * `folderId === null` means the root — items with no parent.
   */
  async getContents(userId: string, folderId: string | null, query: FolderContentsQueryDto = {}) {
    const page = Math.max(1, query.page ?? 1);
    const size = Math.min(1000, Math.max(1, query.size ?? 250));

    let folder = null;
    let subtreeIds: string[] | null = null;

    if (folderId) {
      folder = await this.getById(userId, folderId);
      if (query.recursive) {
        const descendants = await this.prisma.folder.findMany({
          where: { ownerId: folder.ownerId, deletedAt: null, path: { startsWith: folder.path } },
          select: { id: true },
        });
        subtreeIds = descendants.map((d) => d.id);
      }
    }

    /**
     * Which assets belong in this listing.
     *
     * Non-recursive means "filed directly here", so at the root that is the
     * loose assets with no folder at all. Recursive at the root means the whole
     * library — previously it was ignored there, so the toggle appeared to do
     * nothing on the Folders page.
     */
    const folderFilter: Prisma.AssetWhereInput['folderId'] | undefined = subtreeIds
      ? { in: subtreeIds }
      : query.recursive && !folderId
        ? undefined
        : folderId;

    const assetWhere: Prisma.AssetWhereInput = {
      ownerId: folder?.ownerId ?? userId,
      deletedAt: null,
      visibility: folder?.isLocked ? AssetVisibility.LOCKED : { in: [AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE] },
      ...(folderFilter === undefined && query.recursive && !folderId ? {} : { folderId: folderFilter }),
    };

    const orderBy = this.assetOrderBy(query.sortBy ?? 'date', query.order ?? 'desc');

    const [folders, albums, assets, assetTotal] = await Promise.all([
      this.prisma.folder.findMany({
        where: folder
          ? { ownerId: folder.ownerId, parentId: folderId, deletedAt: null, isLocked: false }
          : {
              deletedAt: null,
              isLocked: false,
              OR: [
                { ownerId: userId, parentId: null },
                { sharedWith: { some: { userId } } },
              ],
            },
        // The UI shows "N items" on every sub-folder card, so the counts have to
        // come back with the listing rather than in a request per folder.
        include: {
          _count: { select: { assets: true, children: true, albums: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.album.findMany({
        where: {
          ownerId: folder?.ownerId ?? userId,
          folderId,
          deletedAt: null,
          isLocked: false,
        },
        include: { _count: { select: { assets: true } }, ...ALBUM_COVER_INCLUDE },
        orderBy: { name: 'asc' },
      }),
      this.prisma.asset.findMany({
        where: assetWhere,
        orderBy,
        skip: (page - 1) * size,
        take: size,
        include: { exif: true },
      }),
      this.prisma.asset.count({ where: assetWhere }),
    ]);

    return {
      folder: folder ? { ...folder, shared: folder.ownerId !== userId } : null,
      breadcrumbs: folderId ? await this.getBreadcrumbs(userId, folderId) : [],
      folders: folders.map(({ _count, ...folder }) => ({
        ...folder,
        shared: folder.ownerId !== userId,
        assetCount: _count.assets,
        albumCount: _count.albums,
        childCount: _count.children,
        children: [] as never[],
      })),
      albums: albums.map(({ _count, assets, ...album }) => ({
        ...album,
        assetCount: _count.assets,
        ...pickCover(album.thumbnailAssetId, assets),
      })),
      assets,
      pagination: { page, size, total: assetTotal, pages: Math.ceil(assetTotal / size) },
    };
  }

  private assetOrderBy(sortBy: string, order: 'asc' | 'desc'): Prisma.AssetOrderByWithRelationInput[] {
    switch (sortBy) {
      case 'name':
        return [{ originalFileName: order }];
      case 'size':
        return [{ fileSizeInByte: order }];
      case 'added':
        return [{ createdAt: order }];
      default:
        return [{ localDateTime: order }, { createdAt: order }];
    }
  }

  // -- writes ---------------------------------------------------------------

  async create(userId: string, dto: CreateFolderDto) {
    const name = this.normaliseName(dto.name);

    let parent = null;
    if (dto.parentId) {
      parent = await this.getOwnedById(userId, dto.parentId);
      if (parent.depth + 1 >= MAX_DEPTH) {
        throw new BadRequestException(`Folders cannot nest deeper than ${MAX_DEPTH} levels`);
      }
    }

    // Folder names are unique even after a soft delete. Reusing the same name
    // therefore means reviving that exact location; this also lets a repeated
    // directory upload rebuild its path without hitting the database index.
    const deleted = await this.prisma.folder.findFirst({
      where: {
        ownerId: userId,
        parentId: parent?.id ?? null,
        name,
        deletedAt: { not: null },
      },
    });
    if (deleted) return this.restore(userId, deleted.id);

    await this.assertNameFree(userId, dto.parentId ?? null, name);

    // The path contains the folder's own id, which only exists after the insert,
    // so create then patch. Both statements share a transaction.
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.folder.create({
        data: {
          ownerId: userId,
          parentId: parent?.id ?? null,
          name,
          path: '/',
          depth: parent ? parent.depth + 1 : 0,
          isLocked: parent?.isLocked ?? false,
          color: dto.color,
          icon: dto.icon,
        },
      });

      return tx.folder.update({
        where: { id: created.id },
        data: { path: `${parent ? parent.path : '/'}${created.id}/` },
      });
    });
  }

  async update(userId: string, id: string, dto: UpdateFolderDto) {
    const folder = await this.getOwnedById(userId, id);

    if (dto.name !== undefined) {
      const name = this.normaliseName(dto.name);
      if (name !== folder.name) {
        await this.assertNameFree(userId, folder.parentId, name);
      }
      dto.name = name;
    }

    // Paths are id based, so a rename never touches descendants.
    return this.prisma.folder.update({
      where: { id },
      data: { name: dto.name, color: dto.color, icon: dto.icon, sortOrder: dto.sortOrder },
    });
  }

  /**
   * Replaces one leaf folder with an album in the same parent.
   *
   * Albums cannot contain structural children, so conversion is deliberately
   * limited to a folder whose only contents are direct photos. Everything is
   * changed in one transaction so a failed conversion leaves the folder intact.
   */
  async convertToAlbum(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const folder = await tx.folder.findFirst({
        where: { id, ownerId: userId, deletedAt: null },
      });
      if (!folder) throw new NotFoundException('Folder not found');

      const [childFolder, childAlbum, share] = await Promise.all([
        tx.folder.findFirst({
          where: { ownerId: userId, parentId: id, deletedAt: null },
          select: { id: true },
        }),
        tx.album.findFirst({
          where: { ownerId: userId, folderId: id, deletedAt: null },
          select: { id: true },
        }),
        tx.folderUser.findFirst({ where: { folderId: id }, select: { userId: true } }),
      ]);

      if (childFolder || childAlbum) {
        throw new BadRequestException(
          'Move or delete the sub-folders and albums inside this folder before converting it',
        );
      }
      if (share) {
        throw new BadRequestException('Stop sharing this folder before converting it to an album');
      }

      const assets = await tx.asset.findMany({
        where: { ownerId: userId, folderId: id, deletedAt: null },
        select: { id: true },
        orderBy: [{ localDateTime: 'desc' }, { id: 'desc' }],
      });
      if (assets.length === 0) {
        throw new BadRequestException('Only a folder containing photos can be converted to an album');
      }

      const album = await tx.album.create({
        data: {
          ownerId: userId,
          folderId: folder.parentId,
          name: folder.name,
          isLocked: folder.isLocked,
          ...(assets.length > 0 && {
            assets: {
              create: assets.map((asset) => ({ assetId: asset.id, addedById: userId })),
            },
          }),
        },
      });

      // The album replaces the folder in Browse. Keep its photos unfiled rather
      // than moving them beside the album in the parent folder; they remain in
      // the main Photos timeline and are reached structurally through the album.
      await tx.asset.updateMany({
        where: { ownerId: userId, folderId: id },
        data: { folderId: null },
      });
      // Conversion is a replacement, not deletion. Leaving an empty soft-
      // deleted source row made every converted folder appear in Trash.
      await tx.folder.delete({ where: { id } });

      return { ...album, assetCount: assets.length };
    });
  }

  /**
   * Re-parents a folder and rewrites the materialized path of its whole subtree
   * with a single UPDATE.
   */
  async move(userId: string, id: string, parentId: string | null) {
    const folder = await this.getOwnedById(userId, id);
    if (parentId === id) {
      throw new BadRequestException('A folder cannot be moved into itself');
    }
    if ((folder.parentId ?? null) === (parentId ?? null)) {
      return folder;
    }

    let parent = null;
    if (parentId) {
      parent = await this.getOwnedById(userId, parentId);
      // Moving a folder under one of its own descendants would detach the tree.
      if (parent.path.startsWith(folder.path)) {
        throw new BadRequestException('A folder cannot be moved into one of its own sub-folders');
      }
    }

    await this.assertNameFree(userId, parentId ?? null, folder.name, id);

    const oldPath = folder.path;
    const newPath = `${parent ? parent.path : '/'}${folder.id}/`;
    const newDepth = parent ? parent.depth + 1 : 0;
    const depthDelta = newDepth - folder.depth;

    const subtreeDepth = await this.prisma.folder.aggregate({
      where: { ownerId: userId, path: { startsWith: oldPath }, deletedAt: null },
      _max: { depth: true },
    });
    if ((subtreeDepth._max.depth ?? 0) + depthDelta >= MAX_DEPTH) {
      throw new BadRequestException(`The move would nest folders deeper than ${MAX_DEPTH} levels`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Rewrite the prefix on every descendant (and the folder itself).
      // The casts are load bearing: without them the driver sends the offset as
      // an untyped parameter and `SUBSTRING(text FROM $n)` evaluates to NULL.
      await tx.$executeRaw`
        UPDATE folders
        SET path = ${newPath}::text || SUBSTRING(path FROM ${oldPath.length + 1}::int),
            depth = depth + ${depthDelta}::int,
            "updatedAt" = NOW()
        WHERE "ownerId" = ${userId}::uuid AND path LIKE ${`${oldPath}%`}::text
      `;

      await tx.folder.update({ where: { id }, data: { parentId: parentId ?? null } });

      // A folder dragged into a locked branch (or out of one) takes its
      // contents with it.
      const targetLocked = parent?.isLocked ?? false;
      if (targetLocked !== folder.isLocked) {
        await this.applyLockToSubtree(tx, userId, newPath, targetLocked);
      }

      return tx.folder.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Soft-deletes a folder and its subtree. Contained assets go to the trash by
   * default so nothing is lost by a mis-click; pass `keepAssets` to detach them
   * to the root instead.
   */
  async remove(userId: string, id: string, options: { keepAssets?: boolean } = {}) {
    const folder = await this.getOwnedById(userId, id);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const subtree = await tx.folder.findMany({
        where: { ownerId: userId, path: { startsWith: folder.path }, deletedAt: null },
        select: { id: true },
      });
      const ids = subtree.map((f) => f.id);

      if (options.keepAssets) {
        await tx.asset.updateMany({
          where: { ownerId: userId, folderId: { in: ids } },
          data: { folderId: null },
        });
      } else {
        await tx.asset.updateMany({
          where: { ownerId: userId, folderId: { in: ids }, deletedAt: null },
          data: { deletedAt: now, status: 'TRASHED' },
        });
      }

      if (options.keepAssets) {
        // Explicitly keeping contents means both loose photos and albums move
        // to the parent level rather than entering Trash with the folder.
        await tx.album.updateMany({
          where: { ownerId: userId, folderId: { in: ids }, deletedAt: null },
          data: { folderId: null },
        });
      } else {
        // Keep folderId intact: it is the information needed to reconstruct
        // the complete hierarchy when the folder is restored.
        await tx.album.updateMany({
          where: { ownerId: userId, folderId: { in: ids }, deletedAt: null },
          data: { deletedAt: now },
        });
      }

      await tx.folder.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } });

      return { deletedFolders: ids.length };
    });
  }

  async restore(userId: string, id: string) {
    const folder = await this.prisma.folder.findFirst({ where: { id, ownerId: userId } });
    if (!folder) throw new NotFoundException('Folder not found');
    if (!folder.deletedAt) return folder;

    const deletedAt = folder.deletedAt;
    const batch = await this.prisma.folder.findMany({
      where: { ownerId: userId, deletedAt },
      orderBy: { depth: 'asc' },
    });
    // If a child is selected in Trash, restore the top of the hierarchy that
    // was removed in the same delete operation.
    const root = batch.find((candidate) => folder.path.startsWith(candidate.path)) ?? folder;
    const subtree = batch.filter((candidate) => candidate.path.startsWith(root.path));
    const folderIds = subtree.map((candidate) => candidate.id);

    // Restoring a child of a still-deleted parent would leave it unreachable.
    if (root.parentId) {
      const parent = await this.prisma.folder.findFirst({
        where: { id: root.parentId, ownerId: userId, deletedAt: null },
      });
      if (!parent) {
        throw new BadRequestException('Restore the parent folder first');
      }
    }

    const assetRows = await this.prisma.asset.findMany({
      where: { ownerId: userId, folderId: { in: folderIds }, deletedAt },
      select: { id: true },
    });

    const [restoredAlbums, restoredAssets, restoredFolders] = await this.prisma.$transaction([
      this.prisma.album.updateMany({
        where: { ownerId: userId, folderId: { in: folderIds }, deletedAt },
        data: { deletedAt: null },
      }),
      this.prisma.asset.updateMany({
        where: { ownerId: userId, folderId: { in: folderIds }, deletedAt },
        data: { deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.folder.updateMany({
        where: { id: { in: folderIds }, ownerId: userId, deletedAt },
        data: { deletedAt: null },
      }),
    ]);

    const restored = await this.prisma.folder.findUniqueOrThrow({ where: { id: root.id } });
    return {
      ...restored,
      restoredFolders: restoredFolders.count,
      restoredAlbums: restoredAlbums.count,
      restoredAssets: restoredAssets.count,
      restoredAssetIds: assetRows.map((asset) => asset.id),
    };
  }

  async listTrash(userId: string) {
    const deleted = await this.prisma.folder.findMany({
      where: { ownerId: userId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });

    const roots = deleted.filter(
      (folder) =>
        !deleted.some(
          (candidate) =>
            candidate.id !== folder.id &&
            candidate.deletedAt?.getTime() === folder.deletedAt?.getTime() &&
            folder.path.startsWith(candidate.path),
        ),
    );

    return Promise.all(
      roots.map(async (folder) => {
        const folderIds = deleted
          .filter(
            (candidate) =>
              candidate.deletedAt?.getTime() === folder.deletedAt?.getTime() &&
              candidate.path.startsWith(folder.path),
          )
          .map((candidate) => candidate.id);
        const [assetCount, albumCount] = await Promise.all([
          this.prisma.asset.count({
            where: { ownerId: userId, folderId: { in: folderIds }, deletedAt: folder.deletedAt },
          }),
          this.prisma.album.count({
            where: { ownerId: userId, folderId: { in: folderIds }, deletedAt: folder.deletedAt },
          }),
        ]);
        return {
          id: folder.id,
          name: folder.name,
          depth: folder.depth,
          deletedAt: folder.deletedAt,
          folderCount: folderIds.length,
          albumCount,
          assetCount,
        };
      }),
    );
  }

  async deletePermanently(userId: string, id: string) {
    const folder = await this.prisma.folder.findFirst({
      where: { id, ownerId: userId, deletedAt: { not: null } },
    });
    if (!folder) throw new NotFoundException('Folder not found in Trash');

    const batch = await this.prisma.folder.findMany({
      where: { ownerId: userId, deletedAt: folder.deletedAt },
      orderBy: { depth: 'asc' },
    });
    const root = batch.find((candidate) => folder.path.startsWith(candidate.path)) ?? folder;
    const folderIds = batch
      .filter((candidate) => candidate.path.startsWith(root.path))
      .map((candidate) => candidate.id);

    const [albums, folders] = await this.prisma.$transaction([
      this.prisma.album.deleteMany({
        where: { ownerId: userId, folderId: { in: folderIds }, deletedAt: { not: null } },
      }),
      this.prisma.folder.deleteMany({ where: { id: { in: folderIds }, ownerId: userId } }),
    ]);
    return { deletedFolders: folders.count, deletedAlbums: albums.count };
  }

  // -- assets in folders ----------------------------------------------------

  async addAssets(userId: string, folderId: string, assetIds: string[]) {
    const folder = await this.getOwnedById(userId, folderId);
    const { count } = await this.prisma.asset.updateMany({
      where: { id: { in: assetIds }, ownerId: userId, deletedAt: null },
      data: {
        folderId,
        // Keep visibility consistent with where the asset now lives.
        visibility: folder.isLocked ? AssetVisibility.LOCKED : undefined,
      },
    });
    return { moved: count };
  }

  async removeAssets(userId: string, folderId: string, assetIds: string[]) {
    const { count } = await this.prisma.asset.updateMany({
      where: { id: { in: assetIds }, ownerId: userId, folderId },
      data: { folderId: null },
    });
    return { removed: count };
  }

  async getAssetIds(userId: string, folderId: string) {
    await this.getOwnedById(userId, folderId);
    const assets = await this.prisma.asset.findMany({
      where: { ownerId: userId, folderId, deletedAt: null },
      select: { id: true },
      orderBy: [{ localDateTime: 'desc' }, { id: 'desc' }],
    });
    return { ids: assets.map((asset) => asset.id) };
  }

  // -- sharing --------------------------------------------------------------

  /** Shares one folder and every present/future descendant as read-only. */
  async share(userId: string, folderId: string, userIds: string[]) {
    const folder = await this.getOwnedById(userId, folderId);
    const recipients = [...new Set(userIds)].filter((id) => id !== userId);
    if (!recipients.length) throw new BadRequestException('Choose at least one other account');
    if (folder.isLocked) throw new ForbiddenException('Locked folders cannot be shared');

    const lockedDescendant = await this.prisma.folder.findFirst({
      where: { ownerId: userId, path: { startsWith: folder.path }, isLocked: true },
      select: { id: true },
    });
    if (lockedDescendant) {
      throw new ForbiddenException('Unlock or move locked sub-folders before sharing this folder');
    }

    const accounts = await this.prisma.user.findMany({
      where: { id: { in: recipients }, status: UserStatus.ACTIVE, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (accounts.length !== recipients.length) throw new NotFoundException('One or more accounts were not found');

    await this.prisma.folderUser.createMany({
      data: recipients.map((recipientId) => ({ folderId, userId: recipientId })),
      skipDuplicates: true,
    });
    return { folderId, recipients: accounts };
  }

  async removeShare(userId: string, folderId: string, recipientId: string) {
    await this.getOwnedById(userId, folderId);
    const { count } = await this.prisma.folderUser.deleteMany({ where: { folderId, userId: recipientId } });
    if (!count) throw new NotFoundException('Share not found');
    return { successful: true };
  }

  // -- vault ----------------------------------------------------------------

  /** Moves a folder subtree into or out of the vault. Requires an unlocked session. */
  async setLock(userId: string, id: string, isLocked: boolean) {
    const folder = await this.getOwnedById(userId, id);
    if (folder.isLocked === isLocked) return folder;

    if (folder.parentId && !isLocked) {
      const parent = await this.getOwnedById(userId, folder.parentId);
      if (parent.isLocked) {
        throw new ForbiddenException('Move the folder out of the locked branch before unlocking it');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await this.applyLockToSubtree(tx, userId, folder.path, isLocked);
    });

    return this.prisma.folder.findUniqueOrThrow({ where: { id } });
  }

  private async applyLockToSubtree(
    tx: Prisma.TransactionClient,
    userId: string,
    pathPrefix: string,
    isLocked: boolean,
  ) {
    const subtree = await tx.folder.findMany({
      where: { ownerId: userId, path: { startsWith: pathPrefix } },
      select: { id: true },
    });
    const ids = subtree.map((f) => f.id);

    await tx.folder.updateMany({ where: { id: { in: ids } }, data: { isLocked } });
    await tx.album.updateMany({ where: { folderId: { in: ids } }, data: { isLocked } });
    await tx.asset.updateMany({
      where: {
        ownerId: userId,
        folderId: { in: ids },
        // Never promote a live-photo motion part out of HIDDEN.
        visibility: isLocked
          ? { in: [AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE] }
          : AssetVisibility.LOCKED,
      },
      data: { visibility: isLocked ? AssetVisibility.LOCKED : AssetVisibility.TIMELINE },
    });

    if (isLocked) {
      // Locked content must not stay reachable through an existing share.
      const assetWhere = { ownerId: userId, folderId: { in: ids } };
      await Promise.all([
        tx.sharedLinkAsset.deleteMany({ where: { asset: assetWhere } }),
        tx.assetUser.deleteMany({ where: { asset: assetWhere } }),
        tx.folderUser.deleteMany({ where: { folderId: { in: ids } } }),
        tx.albumUser.deleteMany({ where: { album: { folderId: { in: ids } } } }),
      ]);
    }
  }

  // -- helpers --------------------------------------------------------------

  /**
   * Resolves (creating as needed) a `A/B/C` chain under `rootId`. This is what
   * turns a drag-and-dropped directory or a mobile folder scan into real
   * folders without the client having to pre-create them.
   */
  async ensurePath(userId: string, segments: string[], rootId: string | null = null) {
    let parentId = rootId;
    let parent = rootId ? await this.getOwnedById(userId, rootId) : null;

    for (const raw of segments) {
      const name = this.normaliseName(raw);
      if (!name || name === '.' || name === '..') continue;

      const existing = await this.prisma.folder.findFirst({
        where: { ownerId: userId, parentId, name, deletedAt: null },
      });

      if (existing) {
        parent = existing;
      } else {
        parent = await this.create(userId, { name, parentId: parentId ?? undefined });
      }
      parentId = parent.id;
    }

    return parent;
  }

  private normaliseName(name: string) {
    const clean = sanitize(name.trim()).slice(0, 255).trim();
    if (!clean) throw new BadRequestException('Folder name is not valid');
    return clean;
  }

  private async assertNameFree(
    userId: string,
    parentId: string | null,
    name: string,
    exceptId?: string,
  ) {
    const clash = await this.prisma.folder.findFirst({
      where: {
        ownerId: userId,
        parentId,
        name,
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(`A folder named "${name}" already exists here`);
    }
  }
}
