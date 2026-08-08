import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { DateTime } from 'luxon';
import type { AuthDto } from '../../common/auth.types';
import { fromBytes, toBytes } from '../../common/bytes';
import type { AppConfig } from '../../config/configuration';
import { AssetType, AssetVisibility, Prisma } from '../../db';
import { JOB, QUEUE } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { MachineLearningService } from '../../infra/ml/ml.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { FolderService } from '../folder/folder.service';
import { UserService } from '../user/user.service';
import type {
  AssetQueryDto,
  BulkUpdateAssetsDto,
  UpdateAssetDto,
  UploadAssetDto,
} from './asset.dto';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.tif', '.tiff',
  '.bmp', '.svg', '.jxl', '.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2',
  '.pef', '.srw', '.raw',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp', '.mpg', '.mpeg', '.wmv',
  '.flv', '.mts', '.m2ts', '.insv',
]);

export interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobService,
    private readonly folders: FolderService,
    private readonly users: UserService,
    private readonly ml: MachineLearningService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // -- upload ---------------------------------------------------------------

  /**
   * Ingests one uploaded file.
   *
   * The checksum is the contract that makes re-running a phone backup safe: the
   * same bytes from the same owner can only ever produce one asset, so an
   * interrupted upload can simply be retried.
   */
  async createFromUpload(userId: string, file: UploadedFile, dto: UploadAssetDto) {
    await this.users.assertQuota(userId, file.size);

    const checksum = await this.hashFile(file.path);

    // Skipped entirely when the caller has asked for a second copy on purpose.
    const existing = dto.allowDuplicate
      ? null
      : await this.prisma.asset.findFirst({
          where: { ownerId: userId, checksum },
          select: { id: true, deletedAt: true },
        });

    if (existing) {
      // The bytes are already here; drop the temporary copy and tell the client.
      await this.storage.remove(file.path);
      if (existing.deletedAt) {
        // Re-uploading something the user trashed should bring it back rather
        // than silently doing nothing.
        await this.restore(userId, [existing.id]);
        return { id: existing.id, status: 'restored' as const };
      }
      return { id: existing.id, status: 'duplicate' as const };
    }

    const type = this.detectType(file.originalname, file.mimetype);
    const fileCreatedAt = dto.fileCreatedAt ? new Date(dto.fileCreatedAt) : new Date();
    const fileModifiedAt = dto.fileModifiedAt ? new Date(dto.fileModifiedAt) : fileCreatedAt;

    const folderId = await this.resolveFolder(userId, dto);

    const asset = await this.prisma.asset.create({
      data: {
        ownerId: userId,
        type,
        // Points at the incoming file until the move below succeeds.
        originalPath: file.path,
        originalFileName: dto.relativePath
          ? dto.relativePath.split(/[/\\]/).pop()!
          : file.originalname,
        checksum,
        fileSizeInByte: BigInt(file.size),
        deviceAssetId: dto.deviceAssetId || null,
        deviceId: dto.deviceId || null,
        fileCreatedAt,
        fileModifiedAt,
        // Refined once EXIF gives us the real capture time and timezone.
        localDateTime: fileCreatedAt,
        isFavorite: dto.isFavorite ?? false,
        visibility: dto.isLocked ? AssetVisibility.LOCKED : AssetVisibility.TIMELINE,
        duration: dto.duration ?? null,
        folderId,
        jobStatus: { create: {} },
      },
    });

    // Now that the id exists the storage template can be rendered.
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { storageLabel: true },
      });

      const destination = this.storage.buildOriginalPath({
        ownerId: userId,
        storageLabel: user.storageLabel,
        assetId: asset.id,
        originalFileName: asset.originalFileName,
        localDateTime: fileCreatedAt,
        isLocked: Boolean(dto.isLocked),
      });

      const finalPath = await this.storage.move(file.path, destination);
      await this.prisma.asset.update({
        where: { id: asset.id },
        data: { originalPath: finalPath },
      });
    } catch (error) {
      // Never leave a row pointing at a file that is not there.
      await this.prisma.asset.delete({ where: { id: asset.id } });
      await this.storage.remove(file.path);
      throw error;
    }

    if (dto.albumId) {
      // Uploading from inside an album should land in that album.
      await this.prisma.albumAsset
        .create({ data: { albumId: dto.albumId, assetId: asset.id, addedById: userId } })
        .catch(() => undefined);
      await this.prisma.album
        .update({
          where: { id: dto.albumId },
          data: { updatedAt: new Date() },
        })
        .catch(() => undefined);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { quotaUsageInBytes: { increment: BigInt(file.size) } },
    });

    await this.jobs.onAssetUploaded(asset.id);

    return { id: asset.id, status: 'created' as const };
  }

  private async resolveFolder(userId: string, dto: UploadAssetDto) {
    if (dto.relativePath) {
      // "2024/Iceland/img.jpg" -> folders 2024 > Iceland
      const segments = dto.relativePath.split(/[/\\]/).filter(Boolean).slice(0, -1);
      if (segments.length > 0) {
        const folder = await this.folders.ensurePath(userId, segments, dto.folderId ?? null);
        return folder?.id ?? dto.folderId ?? null;
      }
    }
    return dto.folderId ?? null;
  }

  private hashFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha1');
      createReadStream(path)
        .on('data', (chunk) => hash.update(chunk))
        .on('error', reject)
        .on('end', () => resolve(toBytes(hash.digest())));
    });
  }

  private detectType(filename: string, mimetype: string): AssetType {
    const ext = extname(filename).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext) || mimetype.startsWith('image/')) return AssetType.IMAGE;
    if (VIDEO_EXTENSIONS.has(ext) || mimetype.startsWith('video/')) return AssetType.VIDEO;
    if (mimetype.startsWith('audio/')) return AssetType.AUDIO;
    return AssetType.OTHER;
  }

  /**
   * Lets a client ask "which of these do you already have?" before spending
   * bandwidth. This is what makes a phone backup resume cheaply.
   */
  async checkDuplicates(userId: string, checksums: string[]) {
    const buffers = checksums.map((c) => this.parseChecksum(c));
    const existing = await this.prisma.asset.findMany({
      where: { ownerId: userId, checksum: { in: buffers } },
      select: { id: true, checksum: true },
    });

    const byHex = new Map(existing.map((a) => [fromBytes(a.checksum).toString('hex'), a.id]));
    return checksums.map((checksum) => {
      const hex = fromBytes(this.parseChecksum(checksum)).toString('hex');
      return { checksum, assetId: byHex.get(hex) ?? null, exists: byHex.has(hex) };
    });
  }

  private parseChecksum(value: string): Uint8Array<ArrayBuffer> {
    // Clients send hex; some SDKs send base64. Accept either.
    return toBytes(
      /^[0-9a-f]{40}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64'),
    );
  }

  // -- reads ----------------------------------------------------------------

  async getById(auth: AuthDto, id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        exif: true,
        folder: { select: { id: true, name: true, path: true } },
        tags: { include: { tag: true } },
        faces: {
          where: { deletedAt: null },
          include: { person: { select: { id: true, name: true, thumbnailPath: true } } },
        },
        albums: { select: { albumId: true } },
      },
    });

    if (!asset || asset.deletedAt) throw new NotFoundException('Asset not found');
    await this.assertCanRead(auth, asset);
    return asset;
  }

  /**
   * Read access is: you own it, a partner shared their library with you, it is
   * in an album shared with you, or the share key names it.
   */
  private async assertCanRead(auth: AuthDto, asset: { id: string; ownerId: string; visibility: AssetVisibility }) {
    if (auth.sharedLink) {
      if (auth.sharedLink.assetIds.includes(asset.id)) return;
      if (auth.sharedLink.albumId) {
        const inAlbum = await this.prisma.albumAsset.findUnique({
          where: { albumId_assetId: { albumId: auth.sharedLink.albumId, assetId: asset.id } },
        });
        if (inAlbum) return;
      }
      throw new ForbiddenException('This link does not grant access to that photo');
    }

    if (asset.ownerId === auth.user.id) {
      if (asset.visibility === AssetVisibility.LOCKED) {
        const until = auth.session?.vaultUnlockedUntil;
        if (!until || until.getTime() < Date.now()) {
          throw new ForbiddenException({ message: 'Vault is locked', code: 'VAULT_LOCKED' });
        }
      }
      return;
    }

    const [partner, sharedAlbum] = await Promise.all([
      this.prisma.partner.findUnique({
        where: { sharedById_sharedWithId: { sharedById: asset.ownerId, sharedWithId: auth.user.id } },
      }),
      this.prisma.albumAsset.findFirst({
        where: { assetId: asset.id, album: { albumUsers: { some: { userId: auth.user.id } } } },
      }),
    ]);

    if (!partner && !sharedAlbum) {
      throw new ForbiddenException('You do not have access to this photo');
    }
  }

  buildWhere(userId: string, query: AssetQueryDto): Prisma.AssetWhereInput {
    return {
      ownerId: userId,
      deletedAt: null,
      visibility: query.visibility ?? AssetVisibility.TIMELINE,
      type: query.type,
      isFavorite: query.isFavorite,
      folderId: query.folderId,
      ...(query.albumId ? { albums: { some: { albumId: query.albumId } } } : {}),
      ...(query.personId ? { faces: { some: { personId: query.personId, deletedAt: null } } } : {}),
      ...(query.filename
        ? { originalFileName: { contains: query.filename, mode: 'insensitive' } }
        : {}),
      /**
       * "Folder" means the tree built inside the app, not the layout on disk.
       * Those are different things: an asset filed under Folder1 still lives at
       * library/<user>/<year>/<date>/, so matching the stored path alone found
       * nothing. Sub-folders are included, because asking for a folder means
       * asking for what is inside it.
       *
       * The disk path stays as a second chance, so someone who does mean the
       * real location is not left without an answer.
       */
      ...(query.path
        ? {
            OR: [
              { folderId: { in: query.folderIds ?? [] } },
              { originalPath: { contains: query.path, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.personIds?.length
        ? {
            // Every named person must appear, not just one of them — "photos of
            // Anna and Ben" means both.
            AND: query.personIds.map((personId) => ({
              faces: { some: { personId, deletedAt: null } },
            })),
          }
        : {}),
      ...(query.takenAfter || query.takenBefore
        ? {
            localDateTime: {
              gte: query.takenAfter ? new Date(query.takenAfter) : undefined,
              lte: query.takenBefore ? new Date(query.takenBefore) : undefined,
            },
          }
        : {}),
      ...(query.city ||
      query.country ||
      query.state ||
      query.make ||
      query.model ||
      query.lensModel ||
      query.rating !== undefined ||
      query.description ||
      query.withGeo
        ? {
            exif: {
              city: query.city,
              country: query.country,
              state: query.state,
              make: query.make,
              model: query.model,
              lensModel: query.lensModel,
              rating: query.rating,
              ...(query.description
                ? { description: { contains: query.description, mode: 'insensitive' } }
                : {}),
              ...(query.withGeo ? { latitude: { not: null } } : {}),
            },
          }
        : {}),
      // "Loose" photos: everything that never made it into an album, which is
      // the usual way of finding what still needs filing.
      ...(query.notInAlbum ? { albums: { none: {} } } : {}),
      ...(query.withPeople ? { faces: { some: { personId: { not: null }, deletedAt: null } } } : {}),
    };
  }

  private orderBy(query: AssetQueryDto): Prisma.AssetOrderByWithRelationInput[] {
    const order = query.order ?? 'desc';
    switch (query.sortBy) {
      case 'added':
        return [{ createdAt: order }];
      case 'name':
        return [{ originalFileName: order }];
      case 'size':
        return [{ fileSizeInByte: order }];
      case 'rating':
        return [{ exif: { rating: order } }, { localDateTime: 'desc' }];
      default:
        return [{ localDateTime: order }, { id: 'desc' }];
    }
  }

  async query(userId: string, query: AssetQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const size = Math.min(1000, query.size ?? 100);

    // Resolved before the where-clause is built, because matching a folder by
    // name means matching everything beneath it too.
    const resolved = query.path
      ? { ...query, folderIds: await this.folderIdsMatching(userId, query.path) }
      : query;

    const where = this.buildWhere(userId, resolved);

    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        include: { exif: true },
        orderBy: this.orderBy(query),
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.asset.count({ where }),
    ]);

    return { items, pagination: { page, size, total, pages: Math.ceil(total / size) } };
  }

  /**
   * Finds photos by what is in them.
   *
   * The phrase is turned into a vector in the same space the photos were encoded
   * into, and pgvector orders by cosine distance against the HNSW index. There is
   * no keyword matching anywhere in this: "sunrise on the beach" finds a sunrise
   * over water whether or not those words appear in the file name.
   *
   * Ordering is by similarity, so the usual sort options do not apply — the
   * whole point is that the closest matches come first.
   */
  async searchByContext(userId: string, text: string, limit = 200) {
    const embedding = await this.ml.encodeText(text);
    if (!embedding) {
      throw new ServiceUnavailableException(
        'Searching by picture content is not available on this server yet.',
      );
    }

    const vector = `[${embedding.join(',')}]`;

    const rows = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT a.id, (s.embedding <=> ${vector}::vector) AS distance
      FROM smart_search s
      JOIN assets a ON a.id = s."assetId"
      WHERE a."ownerId" = ${userId}::uuid
        AND a."deletedAt" IS NULL
        AND a.visibility <> 'LOCKED'
      ORDER BY s.embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;

    if (rows.length === 0) return { items: [], pagination: { page: 1, size: limit, total: 0 } };

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: { exif: true },
    });

    // Restore the similarity order the database sorted them into.
    const rank = new Map(rows.map((row, index) => [row.id, index]));
    const items = assets.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);

    return { items, pagination: { page: 1, size: limit, total: items.length } };
  }

  /**
   * Albums and folders whose names contain the text, with the photos inside
   * them. "Full path" was the wrong idea: nobody thinks about where a file sits
   * on disk — they think about the album or folder they put it in.
   */
  async searchPlaces(userId: string, text: string) {
    if (!text.trim()) return { folders: [], albums: [], items: [] };

    const [folders, albums] = await Promise.all([
      this.prisma.folder.findMany({
        where: { ownerId: userId, deletedAt: null, name: { contains: text, mode: 'insensitive' } },
        select: { id: true, name: true, path: true },
        take: 50,
      }),
      this.prisma.album.findMany({
        where: { ownerId: userId, deletedAt: null, name: { contains: text, mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 50,
      }),
    ]);

    const folderIds = await this.folderIdsMatching(userId, text);

    const items = await this.prisma.asset.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        visibility: { not: 'LOCKED' },
        OR: [
          ...(folderIds.length ? [{ folderId: { in: folderIds } }] : []),
          ...(albums.length
            ? [{ albums: { some: { albumId: { in: albums.map((a) => a.id) } } } }]
            : []),
        ],
      },
      include: { exif: true },
      orderBy: [{ localDateTime: 'desc' }],
      take: 500,
    });

    return {
      folders,
      albums: await Promise.all(
        albums.map(async (album) => ({
          ...album,
          assetCount: await this.prisma.albumAsset.count({ where: { albumId: album.id } }),
        })),
      ),
      items,
      pagination: { page: 1, size: 500, total: items.length },
    };
  }

  /**
   * Every folder whose name contains the text, plus all of their descendants.
   *
   * Descendants come free from the materialised path: a child's `path` always
   * contains its parent's id, so one `startsWith` per match collects the whole
   * subtree without walking the tree in application code.
   */
  private async folderIdsMatching(userId: string, text: string) {
    const matches = await this.prisma.folder.findMany({
      where: { ownerId: userId, deletedAt: null, name: { contains: text, mode: 'insensitive' } },
      select: { id: true, path: true },
    });
    if (matches.length === 0) return [];

    const subtrees = await this.prisma.folder.findMany({
      where: {
        ownerId: userId,
        deletedAt: null,
        OR: matches.map((folder) => ({ path: { startsWith: folder.path } })),
      },
      select: { id: true },
    });

    return subtrees.map((folder) => folder.id);
  }

  /**
   * The distinct values actually present in this library, for the search form's
   * dropdowns. Offering a free-text box for "camera make" invites typos that
   * silently match nothing; a list of what exists cannot be wrong.
   */
  /**
   * Every place this library has photos in, largest first.
   *
   * Grouped in the database rather than by pulling assets and counting in
   * memory: a library is hundreds of thousands of rows and a dozen places, and
   * the answer is the dozen.
   *
   * A cover comes back with each one because a list of place names is a list of
   * words, and this is a photo app — the most recent photo taken there is what
   * makes "Kyoto" mean something at a glance.
   */
  async places(userId: string) {
    const rows = await this.prisma.$queryRaw<
      {
        city: string | null;
        state: string | null;
        country: string | null;
        count: bigint;
        coverAssetId: string;
        latitude: number | null;
        longitude: number | null;
      }[]
    >`
      SELECT DISTINCT ON (e.city, e.country)
        e.city, e.state, e.country,
        COUNT(*) OVER (PARTITION BY e.city, e.country)::bigint AS count,
        a.id AS "coverAssetId",
        e.latitude, e.longitude
      FROM asset_exif e
      JOIN assets a ON a.id = e."assetId"
      WHERE a."ownerId" = ${userId}::uuid
        AND a."deletedAt" IS NULL
        AND a.visibility <> 'LOCKED'
        AND e.city IS NOT NULL
      -- DISTINCT ON keeps the first row of each group, so ordering by date
      -- within the group is what makes the cover the newest photo there.
      ORDER BY e.city, e.country, a."localDateTime" DESC
    `;

    return rows
      .map(({ count, ...place }) => ({ ...place, count: Number(count) }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Coordinates for every photo that has them, for plotting.
   *
   * Deliberately thin — an id and two numbers. The map holds all of them at
   * once to cluster them, and sending the full asset for each would be
   * megabytes of EXIF nobody is going to look at.
   */
  async mapPoints(userId: string) {
    const rows = await this.prisma.$queryRaw<
      { id: string; latitude: number; longitude: number; city: string | null }[]
    >`
      SELECT a.id, e.latitude, e.longitude, e.city
      FROM asset_exif e
      JOIN assets a ON a.id = e."assetId"
      WHERE a."ownerId" = ${userId}::uuid
        AND a."deletedAt" IS NULL
        AND a.visibility <> 'LOCKED'
        AND e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
      ORDER BY a."localDateTime" DESC
    `;
    return rows;
  }

  /** Photos that have coordinates but no place name yet, for the backfill. */
  async assetsMissingPlace(userId: string) {
    return this.prisma.assetExif.findMany({
      where: {
        asset: { ownerId: userId, deletedAt: null },
        latitude: { not: null },
        longitude: { not: null },
        city: null,
      },
      select: { assetId: true, latitude: true, longitude: true },
    });
  }

  /**
   * The device asset ids this owner has already backed up.
   *
   * Deliberately not scoped to a `deviceId`. That id is minted per install, so a
   * reinstall — or a TestFlight build sitting alongside a development one, which
   * is the case that found this — looks like a brand new phone and offers to
   * upload the whole camera roll again. The photo ids themselves come from the
   * OS and outlive any one install, so matching on those is what actually
   * answers "have I sent this picture before".
   */
  async backedUpDeviceAssetIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.asset.findMany({
      where: { ownerId: userId, deletedAt: null, deviceAssetId: { not: null } },
      select: { deviceAssetId: true },
      distinct: ['deviceAssetId'],
    });

    return rows.flatMap((row) => (row.deviceAssetId ? [row.deviceAssetId] : []));
  }

  async searchFacets(userId: string) {
    const distinct = async (column: string) => {
      const rows = await this.prisma.$queryRawUnsafe<{ value: string }[]>(
        `SELECT DISTINCT e."${column}" AS value
         FROM asset_exif e
         JOIN assets a ON a.id = e."assetId"
         WHERE a."ownerId" = $1::uuid
           AND a."deletedAt" IS NULL
           AND e."${column}" IS NOT NULL
           AND e."${column}" <> ''
         ORDER BY value
         LIMIT 500`,
        userId,
      );
      return rows.map((row) => row.value);
    };

    const [country, state, city, make, model, lensModel] = await Promise.all([
      distinct('country'),
      distinct('state'),
      distinct('city'),
      distinct('make'),
      distinct('model'),
      distinct('lensModel'),
    ]);

    return { country, state, city, make, model, lensModel };
  }

  /** Photos with no search description yet, so a backfill can pick them up. */
  async assetsMissingSearchIndex(userId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id
      FROM assets a
      LEFT JOIN smart_search s ON s."assetId" = a.id
      WHERE a."ownerId" = ${userId}::uuid
        AND a."deletedAt" IS NULL
        AND a.visibility <> 'LOCKED'
        AND a."previewPath" IS NOT NULL
        AND s."assetId" IS NULL
    `;
    return rows.map((row) => row.id);
  }

  async queueSearchIndexing(assetIds: string[]) {
    // Failed attempts keep their job id, so release it or a retry is dropped.
    await this.jobs.releaseJobIds(QUEUE.SMART_SEARCH, JOB.ENCODE_CLIP, assetIds);
    await this.jobs.enqueueMany(
      QUEUE.SMART_SEARCH,
      JOB.ENCODE_CLIP,
      assetIds.map((assetId) => ({ assetId })),
    );
  }

  /** How many photos have been described for content search, and how many remain. */
  async searchIndexStatus(userId: string) {
    const [total, indexed] = await Promise.all([
      this.prisma.asset.count({
        where: { ownerId: userId, deletedAt: null, visibility: { not: 'LOCKED' } },
      }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM smart_search s
        JOIN assets a ON a.id = s."assetId"
        WHERE a."ownerId" = ${userId}::uuid AND a."deletedAt" IS NULL
      `.then((rows) => Number(rows[0]?.count ?? 0)),
    ]);

    return { total, indexed, available: await this.ml.isReady() };
  }

  /**
   * Month buckets with counts. The clients use this to size the scrollbar and
   * lazily fetch one month at a time instead of paging a 200k-photo list.
   */
  async timelineBuckets(userId: string, query: AssetQueryDto) {
    const where = this.buildWhere(userId, query);
    const grouped = await this.prisma.asset.groupBy({
      by: ['localDateTime'],
      where,
      _count: true,
    });

    const buckets = new Map<string, number>();
    for (const row of grouped) {
      const key = DateTime.fromJSDate(row.localDateTime).toFormat('yyyy-MM-01');
      buckets.set(key, (buckets.get(key) ?? 0) + row._count);
    }

    return [...buckets.entries()]
      .map(([timeBucket, count]) => ({ timeBucket, count }))
      .sort((a, b) => (a.timeBucket < b.timeBucket ? 1 : -1));
  }

  async timelineBucket(userId: string, timeBucket: string, query: AssetQueryDto) {
    const start = DateTime.fromISO(timeBucket);
    if (!start.isValid) throw new BadRequestException('timeBucket must look like 2024-06-01');

    return this.prisma.asset.findMany({
      where: {
        ...this.buildWhere(userId, query),
        localDateTime: { gte: start.toJSDate(), lt: start.plus({ months: 1 }).toJSDate() },
      },
      include: { exif: true },
      orderBy: [{ localDateTime: 'desc' }, { id: 'desc' }],
    });
  }

  async statistics(userId: string) {
    const [images, videos, favorites, trashed, archived, locked, size] = await Promise.all([
      this.prisma.asset.count({ where: { ownerId: userId, type: 'IMAGE', deletedAt: null } }),
      this.prisma.asset.count({ where: { ownerId: userId, type: 'VIDEO', deletedAt: null } }),
      this.prisma.asset.count({ where: { ownerId: userId, isFavorite: true, deletedAt: null } }),
      this.prisma.asset.count({ where: { ownerId: userId, deletedAt: { not: null } } }),
      this.prisma.asset.count({ where: { ownerId: userId, visibility: 'ARCHIVE', deletedAt: null } }),
      this.prisma.asset.count({ where: { ownerId: userId, visibility: 'LOCKED', deletedAt: null } }),
      this.prisma.asset.aggregate({
        where: { ownerId: userId, deletedAt: null },
        _sum: { fileSizeInByte: true },
      }),
    ]);

    return {
      images,
      videos,
      total: images + videos,
      favorites,
      trashed,
      archived,
      locked,
      usageInBytes: size._sum.fileSizeInByte ?? 0n,
    };
  }

  // -- writes ---------------------------------------------------------------

  async update(userId: string, id: string, dto: UpdateAssetDto) {
    const asset = await this.prisma.asset.findFirst({ where: { id, ownerId: userId } });
    if (!asset) throw new NotFoundException('Asset not found');

    const hasExifEdit =
      dto.description !== undefined ||
      dto.rating !== undefined ||
      dto.latitude !== undefined ||
      dto.longitude !== undefined ||
      dto.dateTimeOriginal !== undefined;

    return this.prisma.asset.update({
      where: { id },
      data: {
        // Display name only. Renaming the file on disk would break the stored
        // path for no gain — the layout there is the storage template's job.
        originalFileName: dto.originalFileName?.trim() || undefined,
        isFavorite: dto.isFavorite,
        visibility: dto.visibility,
        folderId: dto.folderId === undefined ? undefined : dto.folderId,
        // Editing the capture date has to move the asset in the timeline too.
        localDateTime: dto.dateTimeOriginal ? new Date(dto.dateTimeOriginal) : undefined,
        ...(hasExifEdit
          ? {
              exif: {
                upsert: {
                  create: {
                    description: dto.description ?? '',
                    rating: dto.rating,
                    latitude: dto.latitude,
                    longitude: dto.longitude,
                    dateTimeOriginal: dto.dateTimeOriginal ? new Date(dto.dateTimeOriginal) : undefined,
                  },
                  update: {
                    description: dto.description,
                    rating: dto.rating,
                    latitude: dto.latitude,
                    longitude: dto.longitude,
                    dateTimeOriginal: dto.dateTimeOriginal ? new Date(dto.dateTimeOriginal) : undefined,
                  },
                },
              },
            }
          : {}),
      },
      include: { exif: true },
    });
  }

  async bulkUpdate(userId: string, dto: BulkUpdateAssetsDto) {
    const { count } = await this.prisma.asset.updateMany({
      where: { id: { in: dto.ids }, ownerId: userId, deletedAt: null },
      data: {
        isFavorite: dto.isFavorite,
        visibility: dto.visibility,
        folderId: dto.folderId === undefined ? undefined : dto.folderId,
      },
    });
    return { updated: count };
  }

  // -- trash ----------------------------------------------------------------

  async trash(userId: string, ids: string[]) {
    const { count } = await this.prisma.asset.updateMany({
      where: { id: { in: ids }, ownerId: userId, deletedAt: null },
      data: { deletedAt: new Date(), status: 'TRASHED' },
    });
    return { trashed: count };
  }

  async restore(userId: string, ids: string[]) {
    const { count } = await this.prisma.asset.updateMany({
      where: { id: { in: ids }, ownerId: userId, deletedAt: { not: null } },
      data: { deletedAt: null, status: 'ACTIVE' },
    });
    return { restored: count };
  }

  async restoreAll(userId: string) {
    const { count } = await this.prisma.asset.updateMany({
      where: { ownerId: userId, deletedAt: { not: null } },
      data: { deletedAt: null, status: 'ACTIVE' },
    });
    return { restored: count };
  }

  listTrash(userId: string, page = 1, size = 250) {
    const retentionDays = this.config.get('trash.retentionDays', { infer: true });
    return this.prisma.asset
      .findMany({
        where: { ownerId: userId, deletedAt: { not: null } },
        include: { exif: true },
        orderBy: { deletedAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      })
      .then((items) =>
        items.map((asset) => ({
          ...asset,
          // Surfacing the deadline is what makes the trash feel safe to use.
          purgeAt: new Date(asset.deletedAt!.getTime() + retentionDays * 86_400_000),
        })),
      );
  }

  /** Removes the database rows and every file on disk. Irreversible. */
  async deletePermanently(userId: string, ids: string[]) {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: ids }, ownerId: userId },
      select: {
        id: true,
        originalPath: true,
        thumbnailPath: true,
        previewPath: true,
        encodedVideoPath: true,
        fileSizeInByte: true,
      },
    });

    for (const asset of assets) {
      await this.storage.removeMany([
        asset.originalPath,
        asset.thumbnailPath,
        asset.previewPath,
        asset.encodedVideoPath,
      ]);
    }

    const freed = assets.reduce((sum, a) => sum + a.fileSizeInByte, 0n);
    await this.prisma.asset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
    await this.prisma.user.update({
      where: { id: userId },
      data: { quotaUsageInBytes: { decrement: freed } },
    });

    return { deleted: assets.length, freedBytes: freed };
  }

  async emptyTrash(userId: string) {
    const trashed = await this.prisma.asset.findMany({
      where: { ownerId: userId, deletedAt: { not: null } },
      select: { id: true },
    });
    return this.deletePermanently(userId, trashed.map((a) => a.id));
  }

  // -- media serving --------------------------------------------------------

  /**
   * Resolves the file to stream for a given asset and size, after checking the
   * caller may see it. Falls back to the original when a derivative has not been
   * generated yet, so a photo is viewable the moment it lands.
   */
  async resolveMediaPath(auth: AuthDto, id: string, size: 'thumbnail' | 'preview' | 'original' | 'video') {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset || asset.deletedAt) throw new NotFoundException('Asset not found');
    await this.assertCanRead(auth, asset);

    if (auth.sharedLink && size === 'original' && !auth.sharedLink.allowDownload) {
      throw new ForbiddenException('Downloads are disabled for this link');
    }

    const candidates: Record<typeof size, (string | null)[]> = {
      thumbnail: [asset.thumbnailPath, asset.previewPath, asset.originalPath],
      preview: [asset.previewPath, asset.thumbnailPath, asset.originalPath],
      original: [asset.originalPath],
      video: [asset.encodedVideoPath, asset.originalPath],
    };

    for (const path of candidates[size]) {
      if (path && (await this.storage.exists(path))) {
        return { path, asset };
      }
    }

    throw new NotFoundException('No file available for this asset yet');
  }

  // -- stacks ---------------------------------------------------------------

  async stack(userId: string, primaryAssetId: string, assetIds: string[]) {
    const ids = [...new Set([primaryAssetId, ...assetIds])];
    const owned = await this.prisma.asset.count({
      where: { id: { in: ids }, ownerId: userId, deletedAt: null },
    });
    if (owned !== ids.length) throw new BadRequestException('Some assets are not yours');

    const stack = await this.prisma.stack.create({ data: { ownerId: userId, primaryAssetId } });
    await this.prisma.asset.updateMany({
      where: { id: { in: ids } },
      data: { stackId: stack.id },
    });
    return stack;
  }

  async unstack(userId: string, stackId: string) {
    await this.prisma.asset.updateMany({
      where: { stackId, ownerId: userId },
      data: { stackId: null },
    });
    await this.prisma.stack.deleteMany({ where: { id: stackId, ownerId: userId } });
    return { successful: true };
  }
}
