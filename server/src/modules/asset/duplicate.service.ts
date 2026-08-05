import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { fromBytes } from '../../common/bytes';
import type { AppConfig } from '../../config/configuration';
import { MediaService } from '../../infra/media/media.service';
import { PrismaService } from '../../infra/prisma/prisma.service';

interface Candidate {
  id: string;
  type: string;
  checksum: Uint8Array;
  perceptualHash: string | null;
}

/**
 * How many of the 64 hash bits may differ before two pictures stop counting as
 * the same shot. Six is deliberately conservative: it comfortably absorbs a
 * resize or a re-compress, but does not start pulling in different frames of
 * the same burst.
 */
const MAX_DISTANCE = 6;

/**
 * The hash is split into this many bands for candidate lookup. Two hashes
 * within MAX_DISTANCE differing bits must share at least one identical band,
 * because 8 bands cannot each absorb a differing bit when only 6 differ
 * (pigeonhole). That turns an all-pairs comparison into a handful of map
 * lookups, which is what makes this workable on a library of any size.
 */
const BANDS = 8;
const BAND_BITS = 64 / BANDS;

@Injectable()
export class DuplicateService {
  private readonly logger = new Logger(DuplicateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private static hamming(a: string, b: string) {
    let distance = 0;
    let xor = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    while (xor > 0n) {
      distance += Number(xor & 1n);
      xor >>= 1n;
    }
    return distance;
  }

  /**
   * Rejects hashes that describe nothing.
   *
   * A flat colour, a plain gradient or a solid poster frame produces a hash of
   * all zeros, or the same byte repeated for all eight rows. Such hashes are
   * within a bit or two of each other by construction, so treating them as a
   * match groups every featureless picture in the library into one giant false
   * positive. They carry no evidence, so they get no vote — those assets can
   * still be matched by checksum, which is exact.
   */
  private static isDegenerate(hash: string) {
    const rows = hash.match(/.{2}/g) ?? [];
    // Every row identical means the picture has no vertical structure at all.
    if (new Set(rows).size <= 1) return true;

    let bits = 0;
    let value = BigInt(`0x${hash}`);
    while (value > 0n) {
      bits += Number(value & 1n);
      value >>= 1n;
    }
    // Almost-all-dark or almost-all-light gradients, same problem.
    return bits < 8 || bits > 56;
  }

  private static bandsOf(hash: string) {
    const bands: string[] = [];
    for (let i = 0; i < BANDS; i++) {
      bands.push(`${i}:${hash.slice(i * (BAND_BITS / 4), (i + 1) * (BAND_BITS / 4))}`);
    }
    return bands;
  }

  /**
   * Rebuilds every duplicate group for one owner.
   *
   * Runs over the whole library rather than incrementally, because a new photo
   * can join two previously separate groups into one and only a full pass gets
   * that right. It is cheap enough: one query plus banded lookups.
   */
  /**
   * Fills in hashes for assets that were uploaded before this feature existed.
   *
   * Hashed from the stored preview rather than the original, which is both far
   * cheaper and safe: the preview is a faithful downscale, and the hash reduces
   * everything to an 8x8 gradient grid anyway.
   */
  private async backfillHashes(ownerId: string) {
    const missing = await this.prisma.asset.findMany({
      where: { ownerId, deletedAt: null, perceptualHash: null },
      select: { id: true, previewPath: true, thumbnailPath: true },
    });
    if (missing.length === 0) return 0;

    let hashed = 0;
    for (const asset of missing) {
      const source = asset.previewPath ?? asset.thumbnailPath;
      // Nothing rendered yet — the thumbnail job will hash it when it runs.
      if (!source) continue;

      try {
        const perceptualHash = await this.media.perceptualHash(source);
        await this.prisma.asset.update({ where: { id: asset.id }, data: { perceptualHash } });
        hashed++;
      } catch (error) {
        this.logger.warn(`Could not hash ${asset.id}: ${(error as Error).message}`);
      }
    }

    this.logger.log(`Backfilled ${hashed} perceptual hash(es) for ${ownerId}`);
    return hashed;
  }

  async detectForOwner(ownerId: string) {
    await this.backfillHashes(ownerId);

    const assets = (await this.prisma.asset.findMany({
      where: { ownerId, deletedAt: null },
      select: { id: true, type: true, checksum: true, perceptualHash: true },
    })) as Candidate[];

    // Union-find: each asset starts alone, then merges with anything it matches.
    const parent = new Map<string, string>(assets.map((a) => [a.id, a.id]));
    const find = (id: string): string => {
      const up = parent.get(id)!;
      if (up === id) return id;
      const root = find(up);
      parent.set(id, root);
      return root;
    };
    const union = (a: string, b: string) => {
      const [ra, rb] = [find(a), find(b)];
      if (ra !== rb) parent.set(ra, rb);
    };

    // 1. Identical bytes. Nothing to compare — the checksums simply match.
    const byChecksum = new Map<string, string[]>();
    for (const asset of assets) {
      const key = fromBytes(asset.checksum).toString('hex');
      const bucket = byChecksum.get(key);
      if (bucket) bucket.push(asset.id);
      else byChecksum.set(key, [asset.id]);
    }
    for (const ids of byChecksum.values()) {
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    }

    // 2. Visually the same picture: resized, re-compressed, renamed, re-saved.
    const byBand = new Map<string, Candidate[]>();
    const hashed = assets.filter(
      (a) => a.perceptualHash && !DuplicateService.isDegenerate(a.perceptualHash),
    );

    for (const asset of hashed) {
      for (const band of DuplicateService.bandsOf(asset.perceptualHash!)) {
        const bucket = byBand.get(band);
        if (bucket) bucket.push(asset);
        else byBand.set(band, [asset]);
      }
    }

    const compared = new Set<string>();
    for (const bucket of byBand.values()) {
      // A band shared by half the library means a flat image (all black, all
      // white); comparing every pair in it costs a lot and tells us nothing.
      if (bucket.length > 200) continue;

      for (let i = 0; i < bucket.length; i++) {
        for (let k = i + 1; k < bucket.length; k++) {
          const pair =
            bucket[i].id < bucket[k].id
              ? `${bucket[i].id}|${bucket[k].id}`
              : `${bucket[k].id}|${bucket[i].id}`;
          if (compared.has(pair)) continue;
          compared.add(pair);

          // A video is hashed from one extracted frame, which is far too weak
          // a signal to call it the same thing as a photograph. Identical bytes
          // would still pair them, and that path is exact.
          if (bucket[i].type !== bucket[k].type) continue;

          const distance = DuplicateService.hamming(
            bucket[i].perceptualHash!,
            bucket[k].perceptualHash!,
          );
          if (distance <= MAX_DISTANCE) union(bucket[i].id, bucket[k].id);
        }
      }
    }

    // Collect the groups that ended up with more than one member.
    const groups = new Map<string, string[]>();
    for (const asset of assets) {
      const root = find(asset.id);
      const bucket = groups.get(root);
      if (bucket) bucket.push(asset.id);
      else groups.set(root, [asset.id]);
    }

    const duplicated = [...groups.values()].filter((ids) => ids.length > 1);
    const stillDuplicated = new Set(duplicated.flat());

    await this.prisma.$transaction([
      // Anything no longer in a group loses its marker, so deleting one of a
      // pair clears the other rather than leaving a group of one behind.
      this.prisma.asset.updateMany({
        where: { ownerId, duplicateId: { not: null }, id: { notIn: [...stillDuplicated] } },
        data: { duplicateId: null, duplicateResolvedAt: null },
      }),
      ...duplicated.map((ids) =>
        this.prisma.asset.updateMany({
          where: { id: { in: ids } },
          data: { duplicateId: randomUUID() },
        }),
      ),
    ]);

    this.logger.log(
      `Duplicate scan for ${ownerId}: ${duplicated.length} group(s) across ${stillDuplicated.size} assets`,
    );

    return { groups: duplicated.length, assets: stillDuplicated.size };
  }

  /** The groups themselves, newest first, for the Duplicates screen. */
  async list(ownerId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { ownerId, deletedAt: null, duplicateId: { not: null }, duplicateResolvedAt: null },
      select: {
        id: true,
        duplicateId: true,
        originalFileName: true,
        fileSizeInByte: true,
        localDateTime: true,
        createdAt: true,
        type: true,
        checksum: true,
        perceptualHash: true,
        exif: { select: { exifImageWidth: true, exifImageHeight: true } },
      },
      orderBy: [{ duplicateId: 'asc' }, { fileSizeInByte: 'desc' }],
    });

    const byGroup = new Map<string, typeof assets>();
    for (const asset of assets) {
      const bucket = byGroup.get(asset.duplicateId!);
      if (bucket) bucket.push(asset);
      else byGroup.set(asset.duplicateId!, [asset]);
    }

    return [...byGroup.entries()].map(([duplicateId, items]) => {
      const first = fromBytes(items[0].checksum).toString('hex');
      const identical = items.every((i) => fromBytes(i.checksum).toString('hex') === first);

      return {
        duplicateId,
        // Worth distinguishing: identical bytes are always safe to remove,
        // whereas a visual match might be a better-quality version.
        kind: identical ? ('identical' as const) : ('similar' as const),
        // What is reclaimed by keeping only the largest.
        reclaimableBytes: items
          .slice(1)
          .reduce((sum, i) => sum + Number(i.fileSizeInByte), 0),
        assets: items.map(({ checksum, perceptualHash, ...rest }) => ({
          ...rest,
          fileSizeInByte: rest.fileSizeInByte.toString(),
        })),
      };
    });
  }

  async count(ownerId: string) {
    const groups = await this.prisma.asset.findMany({
      where: { ownerId, deletedAt: null, duplicateId: { not: null }, duplicateResolvedAt: null },
      select: { duplicateId: true },
      distinct: ['duplicateId'],
    });
    return { groups: groups.length };
  }

  /** Marks a group as reviewed so it stops appearing, without deleting anything. */
  async resolve(ownerId: string, duplicateId: string) {
    await this.prisma.asset.updateMany({
      where: { ownerId, duplicateId },
      data: { duplicateResolvedAt: new Date() },
    });
    return { successful: true };
  }
}
