import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { SharedLinkType } from '../../db';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AppConfig } from '../../config/configuration';
import type { CreateSharedLinkDto, UpdateSharedLinkDto } from './share.dto';

// Unambiguous alphabet — no 0/O or 1/l — because people read these aloud.
const KEY_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

/** 24 chars over a 32-symbol alphabet is 120 bits, ample for an unguessable URL. */
const makeKey = (length = 24) =>
  Array.from({ length }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join('');

@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private toPublicUrl(link: { key: string; slug: string | null }) {
    const base = this.config.get('publicUrl', { infer: true });
    return `${base}/share/${link.slug ?? link.key}`;
  }

  async create(userId: string, dto: CreateSharedLinkDto) {
    if (dto.type === SharedLinkType.ALBUM) {
      if (!dto.albumId) throw new BadRequestException('albumId is required for an album link');

      const album = await this.prisma.album.findFirst({
        where: { id: dto.albumId, ownerId: userId, deletedAt: null },
      });
      if (!album) throw new NotFoundException('Album not found');
      if (album.isLocked) throw new ForbiddenException('Locked albums cannot be shared publicly');
    } else if (!dto.assetIds?.length) {
      throw new BadRequestException('assetIds is required for an individual link');
    }

    // Never mint a link that exposes vault content.
    const assetIds = dto.assetIds?.length
      ? (
          await this.prisma.asset.findMany({
            where: {
              id: { in: dto.assetIds },
              ownerId: userId,
              deletedAt: null,
              visibility: { not: 'LOCKED' },
            },
            select: { id: true },
          })
        ).map((a) => a.id)
      : [];

    if (dto.slug) {
      const taken = await this.prisma.sharedLink.findUnique({ where: { slug: dto.slug } });
      if (taken) throw new BadRequestException('That link name is already taken');
    }

    const link = await this.prisma.sharedLink.create({
      data: {
        userId,
        type: dto.type,
        key: makeKey(),
        slug: dto.slug ?? null,
        albumId: dto.albumId ?? null,
        description: dto.description ?? null,
        password: dto.password ? await bcrypt.hash(dto.password, 10) : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        allowUpload: dto.allowUpload ?? false,
        allowDownload: dto.allowDownload ?? true,
        showExif: dto.showExif ?? true,
        assets: { create: assetIds.map((assetId) => ({ assetId })) },
      },
    });

    return { ...link, password: undefined, hasPassword: Boolean(link.password), url: this.toPublicUrl(link) };
  }

  async list(userId: string) {
    const links = await this.prisma.sharedLink.findMany({
      where: { userId },
      include: {
        album: { select: { id: true, name: true, thumbnailAssetId: true } },
        _count: { select: { assets: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return links.map(({ password, _count, ...link }) => ({
      ...link,
      hasPassword: Boolean(password),
      assetCount: _count.assets,
      url: this.toPublicUrl(link),
      isExpired: Boolean(link.expiresAt && link.expiresAt < new Date()),
    }));
  }

  async update(userId: string, id: string, dto: UpdateSharedLinkDto) {
    const link = await this.prisma.sharedLink.findFirst({ where: { id, userId } });
    if (!link) throw new NotFoundException('Share link not found');

    const updated = await this.prisma.sharedLink.update({
      where: { id },
      data: {
        description: dto.description,
        // '' clears the password, undefined leaves it alone.
        password:
          dto.password === undefined ? undefined : dto.password === '' ? null : await bcrypt.hash(dto.password, 10),
        expiresAt: dto.expiresAt === undefined ? undefined : dto.expiresAt ? new Date(dto.expiresAt) : null,
        allowUpload: dto.allowUpload,
        allowDownload: dto.allowDownload,
        showExif: dto.showExif,
      },
    });

    return { ...updated, password: undefined, hasPassword: Boolean(updated.password), url: this.toPublicUrl(updated) };
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.sharedLink.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Share link not found');
    return { successful: true };
  }

  /**
   * Resolves a public key or slug. Returns only what an anonymous visitor is
   * allowed to know before entering a password.
   */
  async resolve(keyOrSlug: string, password?: string) {
    const link = await this.prisma.sharedLink.findFirst({
      where: { OR: [{ key: keyOrSlug }, { slug: keyOrSlug }] },
      include: {
        album: { select: { id: true, name: true, description: true, thumbnailAssetId: true } },
        user: { select: { id: true, name: true } },
        _count: { select: { assets: true } },
      },
    });

    if (!link) throw new NotFoundException('This link does not exist');
    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new ForbiddenException('This link has expired');
    }

    if (link.password) {
      if (!password) {
        return { requiresPassword: true, description: link.description, key: null };
      }
      if (!(await bcrypt.compare(password, link.password))) {
        throw new UnauthorizedException('Incorrect password');
      }
    }

    return {
      requiresPassword: false,
      // Handing back the real key lets the client authenticate later requests.
      key: link.key,
      id: link.id,
      type: link.type,
      description: link.description,
      album: link.album,
      owner: link.user,
      assetCount: link._count.assets,
      allowUpload: link.allowUpload,
      allowDownload: link.allowDownload,
      showExif: link.showExif,
      expiresAt: link.expiresAt,
    };
  }

  /** Assets behind an INDIVIDUAL link. Album links go through the album API. */
  async listAssets(linkId: string) {
    const rows = await this.prisma.sharedLinkAsset.findMany({
      where: { sharedLinkId: linkId, asset: { deletedAt: null } },
      include: { asset: { include: { exif: true } } },
      orderBy: { asset: { localDateTime: 'desc' } },
    });
    return rows.map((r) => r.asset);
  }
}
