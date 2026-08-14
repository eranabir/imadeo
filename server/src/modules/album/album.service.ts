import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlbumUserRole, AssetVisibility, Prisma } from '../../db';
import type { AppConfig } from '../../config/configuration';
import { MailService } from '../../infra/mail/mail.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { InvitationService } from '../auth/invitation.service';
import { AssetLifecycleService } from '../asset/asset-lifecycle.service';
import type { AuthDto } from '../../common/auth.types';
import type {
  AlbumAssetsQueryDto,
  AlbumQueryDto,
  CreateActivityDto,
  CreateAlbumDto,
  UpdateAlbumDto,
} from './album.dto';

type Access = 'owner' | 'editor' | 'viewer';

/**
 * Newest few live assets in the album, used to derive a cover.
 *
 * A few rather than one because the explicitly chosen cover may since have been
 * trashed, in which case we still want a real picture rather than a grey icon.
 */
export const ALBUM_COVER_INCLUDE = {
  assets: {
    where: { asset: { deletedAt: null } },
    orderBy: { asset: { localDateTime: 'desc' } },
    take: 8,
    select: { assetId: true },
  },
} as const;

/**
 * An album should show pictures from inside it, never a placeholder icon,
 * whenever it holds anything at all.
 *
 * Returns the single best cover plus up to four ids for a mosaic, with the
 * chosen cover first so it stays the dominant tile.
 */
export const pickCover = (
  thumbnailAssetId: string | null,
  assets: { assetId: string }[],
): { coverAssetId: string | null; coverAssetIds: string[] } => {
  const ids = assets.map((a) => a.assetId);

  // Honour a deliberately chosen cover, but only while that asset still exists.
  const chosen = thumbnailAssetId && ids.includes(thumbnailAssetId) ? thumbnailAssetId : ids[0];

  if (!chosen) return { coverAssetId: null, coverAssetIds: [] };

  const ordered = [chosen, ...ids.filter((id) => id !== chosen)];
  return { coverAssetId: chosen, coverAssetIds: ordered.slice(0, 4) };
};

@Injectable()
export class AlbumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly invitations: InvitationService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly assetLifecycle: AssetLifecycleService,
  ) {}

  // -- access ---------------------------------------------------------------

  /**
   * Resolves what the caller may do with an album. A public share key grants
   * viewer access to exactly the album it was minted for.
   */
  async getAccess(auth: AuthDto, albumId: string): Promise<Access> {
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, deletedAt: null },
      include: { albumUsers: { where: { userId: auth.user.id } } },
    });
    if (!album) throw new NotFoundException('Album not found');

    if (auth.sharedLink) {
      if (auth.sharedLink.albumId !== albumId) {
        throw new ForbiddenException('This link does not grant access to that album');
      }
      return 'viewer';
    }

    if (album.ownerId === auth.user.id) return 'owner';
    if (album.isLocked) throw new ForbiddenException('Locked albums cannot be shared');

    const membership = album.albumUsers[0];
    if (membership) return membership.role === AlbumUserRole.EDITOR ? 'editor' : 'viewer';
    if (album.folderId && (await this.hasSharedFolderAccess(auth.user.id, album.folderId))) return 'viewer';
    throw new ForbiddenException('You do not have access to this album');
  }

  /** Folder shares make the whole folder tree viewable, including its albums. */
  private async hasSharedFolderAccess(userId: string, folderId: string) {
    const [result] = await this.prisma.$queryRaw<{ allowed: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM folders target
        JOIN folder_users fu ON fu."userId" = ${userId}::uuid
        JOIN folders root ON root.id = fu."folderId"
        WHERE target.id = ${folderId}::uuid
          AND target."deletedAt" IS NULL
          AND target."isLocked" = false
          AND root."deletedAt" IS NULL
          AND root."isLocked" = false
          AND target.path LIKE root.path || '%'
      ) AS allowed
    `;
    return result?.allowed ?? false;
  }

  /** Folder ancestry visible to this album viewer, ordered root to parent. */
  private async getFolderBreadcrumbs(
    auth: AuthDto,
    ownerId: string,
    folder: { id: string; path: string },
  ) {
    let ids = folder.path.split('/').filter(Boolean);

    // A direct album share must not reveal its owner's private folder tree.
    // Folder-share recipients see only from the shared root downwards.
    if (ownerId !== auth.user.id) {
      if (auth.sharedLink) return [];
      const roots = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT root.id
        FROM folder_users fu
        JOIN folders root ON root.id = fu."folderId"
        JOIN folders target ON target.id = ${folder.id}::uuid
        WHERE fu."userId" = ${auth.user.id}::uuid
          AND root."deletedAt" IS NULL
          AND root."isLocked" = false
          AND target.path LIKE root.path || '%'
        ORDER BY root.depth DESC
        LIMIT 1
      `;
      const sharedRootIndex = ids.indexOf(roots[0]?.id ?? '');
      if (sharedRootIndex < 0) return [];
      ids = ids.slice(sharedRootIndex);
    }

    const folders = await this.prisma.folder.findMany({
      where: { id: { in: ids }, ownerId, deletedAt: null },
      select: { id: true, name: true, isLocked: true },
    });
    const byId = new Map(folders.map((candidate) => [candidate.id, candidate]));
    return ids
      .map((id) => byId.get(id))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  }

  private async assertCanEdit(auth: AuthDto, albumId: string) {
    const access = await this.getAccess(auth, albumId);
    if (access === 'viewer') {
      throw new ForbiddenException('You only have view access to this album');
    }
    return access;
  }

  private async assertIsOwner(auth: AuthDto, albumId: string) {
    if ((await this.getAccess(auth, albumId)) !== 'owner') {
      throw new ForbiddenException('Only the album owner can do that');
    }
  }

  // -- reads ----------------------------------------------------------------

  async list(userId: string, query: AlbumQueryDto = {}) {
    const mine: Prisma.AlbumWhereInput = { ownerId: userId };
    const sharedWithMe: Prisma.AlbumWhereInput = { albumUsers: { some: { userId } } };
    const sharedFolderIds = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT target.id
      FROM folders target
      JOIN folder_users fu ON fu."userId" = ${userId}::uuid
      JOIN folders root ON root.id = fu."folderId"
      WHERE target."deletedAt" IS NULL
        AND target."isLocked" = false
        AND root."deletedAt" IS NULL
        AND root."isLocked" = false
        AND target.path LIKE root.path || '%'
    `;
    const sharedFolder: Prisma.AlbumWhereInput = {
      folderId: { in: sharedFolderIds.map((folder) => folder.id) },
    };

    const sharedAccess: Prisma.AlbumWhereInput = {
      AND: [{ isLocked: false }, { OR: [sharedWithMe, sharedFolder] }],
    };
    const where: Prisma.AlbumWhereInput = {
      deletedAt: null,
      ...(query.includeLocked ? {} : { isLocked: false }),
      ...(query.folderId !== undefined ? { folderId: query.folderId } : {}),
      ...(query.assetId ? { assets: { some: { assetId: query.assetId } } } : {}),
      ...(query.shared
        ? { OR: [{ AND: [mine, { albumUsers: { some: {} } }] }, sharedAccess] }
        : { OR: [mine, sharedAccess] }),
    };

    const albums = await this.prisma.album.findMany({
      where,
      include: {
        _count: { select: { assets: true } },
        albumUsers: { include: { user: { select: { id: true, name: true, email: true, profileImagePath: true } } } },
        owner: { select: { id: true, name: true, email: true, profileImagePath: true } },
        folder: { select: { id: true, name: true, path: true } },
        ...ALBUM_COVER_INCLUDE,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return albums.map(({ _count, assets, ...album }) => ({
      ...album,
      assetCount: _count.assets,
      ...pickCover(album.thumbnailAssetId, assets),
      shared: album.albumUsers.length > 0 || album.ownerId !== userId,
    }));
  }

  async get(auth: AuthDto, albumId: string, query: AlbumAssetsQueryDto = {}) {
    const access = await this.getAccess(auth, albumId);

    const album = await this.prisma.album.findUniqueOrThrow({
      where: { id: albumId },
      include: {
        owner: { select: { id: true, name: true, email: true, profileImagePath: true } },
        albumUsers: { include: { user: { select: { id: true, name: true, email: true, profileImagePath: true } } } },
        folder: { select: { id: true, name: true, path: true } },
        _count: { select: { assets: true } },
        ...ALBUM_COVER_INCLUDE,
      },
    });

    const page = Math.max(1, query.page ?? 1);
    const size = Math.min(1000, Math.max(1, query.size ?? 250));
    const order = query.order ?? (album.order as 'asc' | 'desc');

    // A share link that names individual assets must not expose the rest.
    const restrictTo = auth.sharedLink?.assetIds?.length ? auth.sharedLink.assetIds : null;

    const rows = await this.prisma.albumAsset.findMany({
      where: {
        albumId,
        asset: { deletedAt: null, ...(restrictTo ? { id: { in: restrictTo } } : {}) },
      },
      include: { asset: { include: { exif: true } } },
      orderBy: this.orderBy(query.sortBy ?? 'date', order),
      skip: (page - 1) * size,
      take: size,
    });

    const { _count, assets: coverAssets, ...rest } = album;
    const breadcrumbs = album.folder
      ? await this.getFolderBreadcrumbs(auth, album.ownerId, album.folder)
      : [];
    const total = await this.prisma.albumAsset.count({
      where: {
        albumId,
        asset: { deletedAt: null, ...(restrictTo ? { id: { in: restrictTo } } : {}) },
      },
    });
    return {
      ...rest,
      access,
      breadcrumbs,
      assetCount: total,
      ...pickCover(album.thumbnailAssetId, coverAssets),
      assets: rows.map((r) => ({ ...r.asset, addedAt: r.createdAt, addedById: r.addedById })),
      pagination: { page, size, total },
    };
  }

  /** Every live asset id in an album, independent of the paginated grid. */
  async getAssetIds(auth: AuthDto, albumId: string) {
    await this.getAccess(auth, albumId);
    const restrictTo = auth.sharedLink?.assetIds?.length ? auth.sharedLink.assetIds : null;
    const assets = await this.prisma.albumAsset.findMany({
      where: {
        albumId,
        asset: {
          deletedAt: null,
          ...(restrictTo ? { id: { in: restrictTo } } : {}),
        },
      },
      select: { assetId: true },
      orderBy: [{ asset: { localDateTime: 'desc' } }, { assetId: 'desc' }],
    });
    return { ids: assets.map((asset) => asset.assetId) };
  }

  private orderBy(sortBy: string, order: 'asc' | 'desc'): Prisma.AlbumAssetOrderByWithRelationInput[] {
    switch (sortBy) {
      case 'name':
        return [{ asset: { originalFileName: order } }];
      case 'size':
        return [{ asset: { fileSizeInByte: order } }];
      case 'added':
        return [{ createdAt: order }];
      default:
        return [{ asset: { localDateTime: order } }];
    }
  }

  async statistics(userId: string) {
    const [owned, shared, notShared] = await Promise.all([
      this.prisma.album.count({ where: { ownerId: userId, deletedAt: null } }),
      this.prisma.album.count({ where: { albumUsers: { some: { userId } }, deletedAt: null } }),
      this.prisma.album.count({
        where: { ownerId: userId, deletedAt: null, albumUsers: { none: {} } },
      }),
    ]);
    return { owned, shared, notShared };
  }

  async listTrash(userId: string) {
    const albums = await this.prisma.album.findMany({
      where: {
        ownerId: userId,
        deletedAt: { not: null },
        OR: [{ folderId: null }, { folder: { deletedAt: null } }],
      },
      include: ALBUM_COVER_INCLUDE,
      orderBy: { deletedAt: 'desc' },
    });

    return Promise.all(
      albums.map(async ({ assets, ...album }) => ({
        ...album,
        assetCount: await this.prisma.albumAsset.count({
          where: { albumId: album.id, asset: { ownerId: userId, deletedAt: album.deletedAt } },
        }),
        ...pickCover(album.thumbnailAssetId, assets),
      })),
    );
  }

  // -- writes ---------------------------------------------------------------

  async create(userId: string, dto: CreateAlbumDto) {
    if (dto.folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: dto.folderId, ownerId: userId, deletedAt: null },
      });
      if (!folder) throw new BadRequestException('Target folder does not exist');
    }

    const assetIds = await this.filterOwnedAssets(userId, dto.assetIds ?? []);

    const album = await this.prisma.album.create({
      data: {
        ownerId: userId,
        name: dto.albumName.trim(),
        description: dto.description ?? '',
        folderId: dto.folderId ?? null,
        thumbnailAssetId: assetIds[0] ?? null,
        assets: {
          create: assetIds.map((assetId) => ({ assetId, addedById: userId })),
        },
        albumUsers: {
          create: (dto.albumUsers ?? []).map((u) => ({
            userId: u.userId,
            role: u.role ?? AlbumUserRole.VIEWER,
          })),
        },
      },
      include: { _count: { select: { assets: true } } },
    });

    return { ...album, assetCount: album._count.assets };
  }

  async update(auth: AuthDto, albumId: string, dto: UpdateAlbumDto) {
    await this.assertIsOwner(auth, albumId);

    if (dto.folderId) {
      const folder = await this.prisma.folder.findFirst({
        where: { id: dto.folderId, ownerId: auth.user.id, deletedAt: null },
      });
      if (!folder) throw new BadRequestException('Target folder does not exist');
    }

    if (dto.albumThumbnailAssetId) {
      const inAlbum = await this.prisma.albumAsset.findUnique({
        where: { albumId_assetId: { albumId, assetId: dto.albumThumbnailAssetId } },
      });
      if (!inAlbum) throw new BadRequestException('The cover photo must be inside the album');
    }

    return this.prisma.album.update({
      where: { id: albumId },
      data: {
        name: dto.albumName?.trim(),
        description: dto.description,
        thumbnailAssetId: dto.albumThumbnailAssetId,
        folderId: dto.folderId === undefined ? undefined : dto.folderId,
        order: dto.order,
        isActivityEnabled: dto.isActivityEnabled,
      },
    });
  }

  async remove(auth: AuthDto, albumId: string) {
    await this.assertIsOwner(auth, albumId);
    const deletedAt = new Date();
    const assetIds = await this.prisma.$transaction(async (tx) => {
      const assets = await tx.albumAsset.findMany({
        where: { albumId, asset: { ownerId: auth.user.id, deletedAt: null } },
        select: { assetId: true },
      });
      const ids = assets.map((asset) => asset.assetId);
      await tx.asset.updateMany({
        where: { id: { in: ids }, ownerId: auth.user.id, deletedAt: null },
        data: { deletedAt, status: 'TRASHED' },
      });
      await tx.album.update({ where: { id: albumId }, data: { deletedAt } });
      return ids;
    });
    await this.assetLifecycle.refreshThumbnailsForAssets(assetIds);
    return { successful: true, trashedAssets: assetIds.length };
  }

  async restore(userId: string, albumId: string) {
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, ownerId: userId, deletedAt: { not: null } },
      include: { folder: { select: { deletedAt: true } } },
    });
    if (!album) throw new NotFoundException('Album not found in Trash');
    if (album.folder?.deletedAt) {
      throw new BadRequestException('Restore the containing folder instead');
    }
    const assets = await this.prisma.albumAsset.findMany({
      where: { albumId, asset: { ownerId: userId, deletedAt: album.deletedAt } },
      select: { assetId: true },
    });
    const assetIds = assets.map((asset) => asset.assetId);
    const [restored] = await this.prisma.$transaction([
      this.prisma.album.update({ where: { id: albumId }, data: { deletedAt: null } }),
      this.prisma.asset.updateMany({
        where: { id: { in: assetIds }, ownerId: userId, deletedAt: album.deletedAt },
        data: { deletedAt: null, status: 'ACTIVE' },
      }),
    ]);
    await this.assetLifecycle.refreshThumbnailsForAssets(assetIds);
    return { ...restored, restoredAssets: assetIds.length };
  }

  async deletePermanently(userId: string, albumId: string) {
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, ownerId: userId, deletedAt: { not: null } },
    });
    if (!album) throw new NotFoundException('Album not found in Trash');

    const assets = await this.prisma.albumAsset.findMany({
      where: { albumId, asset: { ownerId: userId, deletedAt: album.deletedAt } },
      select: { assetId: true },
    });
    const removedAssets = await this.assetLifecycle.deletePermanently(
      userId,
      assets.map((asset) => asset.assetId),
    );
    await this.prisma.album.delete({ where: { id: albumId } });
    return { deleted: 1, deletedAssets: removedAssets.deleted };
  }

  // -- album contents -------------------------------------------------------

  async addAssets(auth: AuthDto, albumId: string, assetIds: string[]) {
    await this.assertCanEdit(auth, albumId);

    const album = await this.prisma.album.findUniqueOrThrow({ where: { id: albumId } });
    const usable = await this.filterVisibleAssets(auth.user.id, assetIds, album.isLocked);

    const existing = await this.prisma.albumAsset.findMany({
      where: { albumId, assetId: { in: usable } },
      select: { assetId: true },
    });
    const already = new Set(existing.map((e) => e.assetId));
    const toAdd = usable.filter((id) => !already.has(id));

    if (toAdd.length > 0) {
      await this.prisma.$transaction([
        this.prisma.albumAsset.createMany({
          data: toAdd.map((assetId) => ({ albumId, assetId, addedById: auth.user.id })),
          skipDuplicates: true,
        }),
        this.prisma.album.update({
          where: { id: albumId },
          data: {
            updatedAt: new Date(),
            thumbnailAssetId: album.thumbnailAssetId ?? toAdd[0],
          },
        }),
      ]);
    }

    return assetIds.map((id) => ({
      id,
      success: toAdd.includes(id),
      error: already.has(id) ? 'duplicate' : usable.includes(id) ? undefined : 'no_permission',
    }));
  }

  async removeAssets(auth: AuthDto, albumId: string, assetIds: string[]) {
    const access = await this.assertCanEdit(auth, albumId);

    // An editor may only pull out what they themselves contributed.
    const removable =
      access === 'owner'
        ? assetIds
        : (
            await this.prisma.albumAsset.findMany({
              where: { albumId, assetId: { in: assetIds }, addedById: auth.user.id },
              select: { assetId: true },
            })
          ).map((r) => r.assetId);

    await this.prisma.albumAsset.deleteMany({ where: { albumId, assetId: { in: removable } } });

    // Repoint the cover if it just left the album.
    const album = await this.prisma.album.findUniqueOrThrow({ where: { id: albumId } });
    if (album.thumbnailAssetId && removable.includes(album.thumbnailAssetId)) {
      const next = await this.prisma.albumAsset.findFirst({
        where: { albumId },
        orderBy: { createdAt: 'asc' },
      });
      await this.prisma.album.update({
        where: { id: albumId },
        data: { thumbnailAssetId: next?.assetId ?? null },
      });
    }

    return assetIds.map((id) => ({
      id,
      success: removable.includes(id),
      error: removable.includes(id) ? undefined : 'no_permission',
    }));
  }

  // -- sharing --------------------------------------------------------------

  async addUsers(auth: AuthDto, albumId: string, users: { userId: string; role?: AlbumUserRole }[]) {
    await this.assertIsOwner(auth, albumId);
    const album = await this.prisma.album.findUniqueOrThrow({ where: { id: albumId } });

    if (album.isLocked) {
      throw new ForbiddenException('Locked albums cannot be shared');
    }

    const filtered = users.filter((u) => u.userId !== auth.user.id);
    await this.prisma.albumUser.createMany({
      data: filtered.map((u) => ({
        albumId,
        userId: u.userId,
        role: u.role ?? AlbumUserRole.VIEWER,
      })),
      skipDuplicates: true,
    });

    return this.list(auth.user.id, {}).then((albums) => albums.find((a) => a.id === albumId));
  }

  /**
   * Shares an album with someone identified only by email.
   *
   * If they already have an account they are simply added. If not, an account
   * is created with a random password and the invite carries it — otherwise a
   * self-hosted instance has no way for the recipient to get in.
   */
  async inviteByEmail(auth: AuthDto, albumId: string, email: string, role: AlbumUserRole) {
    await this.assertIsOwner(auth, albumId);

    const album = await this.prisma.album.findUniqueOrThrow({ where: { id: albumId } });
    if (album.isLocked) {
      throw new ForbiddenException('Locked albums cannot be shared');
    }

    const normalised = email.toLowerCase().trim();
    if (normalised === auth.user.email.toLowerCase()) {
      throw new BadRequestException('That is your own address');
    }

    const user = await this.prisma.user.findUnique({ where: { email: normalised } });

    // Someone who already has an account just gets added.
    if (user) {
      await this.prisma.albumUser.upsert({
        where: { albumId_userId: { albumId, userId: user.id } },
        create: { albumId, userId: user.id, role },
        update: { role },
      });

      const albumUrl = `${this.config.get('publicUrl', { infer: true })}/albums/${albumId}`;
      const delivery = await this.mail.sendAlbumInvite({
        to: normalised,
        inviterName: auth.user.name,
        albumName: album.name,
        albumUrl,
      });

      return {
        user: { id: user.id, email: user.email, name: user.name },
        role,
        accountCreated: false,
        emailSent: delivery.sent,
        url: albumUrl,
      };
    }

    // Otherwise send an invitation. No account and no password is created
    // here — they choose their own details when they accept.
    const invitation = await this.invitations.create({
      email: normalised,
      invitedById: auth.user.id,
      inviterName: auth.user.name,
      albumId,
      albumName: album.name,
      role,
    });

    return {
      user: null,
      role,
      accountCreated: false,
      invited: true,
      emailSent: invitation.emailSent,
      url: invitation.url,
      expiresInDays: invitation.expiresInDays,
    };
  }

  async updateUserRole(auth: AuthDto, albumId: string, userId: string, role: AlbumUserRole) {
    await this.assertIsOwner(auth, albumId);
    return this.prisma.albumUser.update({
      where: { albumId_userId: { albumId, userId } },
      data: { role },
    });
  }

  async removeUser(auth: AuthDto, albumId: string, userId: string) {
    // Leaving an album you were invited to needs no owner rights.
    if (userId !== auth.user.id) {
      await this.assertIsOwner(auth, albumId);
    } else {
      await this.getAccess(auth, albumId);
    }

    await this.prisma.albumUser.deleteMany({ where: { albumId, userId } });
    return { successful: true };
  }

  async setLock(auth: AuthDto, albumId: string, isLocked: boolean) {
    await this.assertIsOwner(auth, albumId);

    return this.prisma.$transaction(async (tx) => {
      if (isLocked) {
        // Locking retracts every existing form of sharing.
        await tx.albumUser.deleteMany({ where: { albumId } });
        await tx.sharedLink.deleteMany({ where: { albumId } });
      }
      return tx.album.update({ where: { id: albumId }, data: { isLocked } });
    });
  }

  // -- activity -------------------------------------------------------------

  async listActivity(auth: AuthDto, albumId: string, assetId?: string) {
    await this.getAccess(auth, albumId);
    return this.prisma.activity.findMany({
      where: { albumId, assetId: assetId ?? undefined },
      include: { user: { select: { id: true, name: true, profileImagePath: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createActivity(auth: AuthDto, albumId: string, dto: CreateActivityDto) {
    await this.getAccess(auth, albumId);
    const album = await this.prisma.album.findUniqueOrThrow({ where: { id: albumId } });
    if (!album.isActivityEnabled) {
      throw new ForbiddenException('Comments are turned off for this album');
    }
    if (dto.type === 'COMMENT' && !dto.comment?.trim()) {
      throw new BadRequestException('A comment cannot be empty');
    }

    if (dto.type === 'LIKE') {
      // Likes are idempotent per user per asset.
      const existing = await this.prisma.activity.findFirst({
        where: { albumId, assetId: dto.assetId ?? null, userId: auth.user.id, type: 'LIKE' },
      });
      if (existing) return existing;
    }

    return this.prisma.activity.create({
      data: {
        albumId,
        assetId: dto.assetId ?? null,
        userId: auth.user.id,
        type: dto.type,
        comment: dto.type === 'COMMENT' ? dto.comment!.trim() : null,
      },
      include: { user: { select: { id: true, name: true, profileImagePath: true } } },
    });
  }

  async deleteActivity(auth: AuthDto, albumId: string, activityId: string) {
    const activity = await this.prisma.activity.findFirst({ where: { id: activityId, albumId } });
    if (!activity) throw new NotFoundException('Activity not found');

    // Your own comment, or anything at all if you own the album.
    if (activity.userId !== auth.user.id) {
      await this.assertIsOwner(auth, albumId);
    }
    await this.prisma.activity.delete({ where: { id: activityId } });
    return { successful: true };
  }

  // -- helpers --------------------------------------------------------------

  private async filterOwnedAssets(userId: string, assetIds: string[]) {
    if (assetIds.length === 0) return [];
    const rows = await this.prisma.asset.findMany({
      where: { id: { in: assetIds }, ownerId: userId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Assets the caller may put into an album: their own, plus anything a partner
   * has shared with them. Vault content only ever goes into a locked album.
   */
  private async filterVisibleAssets(userId: string, assetIds: string[], albumIsLocked: boolean) {
    if (assetIds.length === 0) return [];

    const partners = await this.prisma.partner.findMany({
      where: { sharedWithId: userId },
      select: { sharedById: true },
    });
    const ownerIds = [userId, ...partners.map((p) => p.sharedById)];

    const rows = await this.prisma.asset.findMany({
      where: {
        id: { in: assetIds },
        ownerId: { in: ownerIds },
        deletedAt: null,
        visibility: albumIsLocked
          ? undefined
          : { in: [AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE] },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
