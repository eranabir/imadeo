import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import sharp from 'sharp';
import { DateTime } from 'luxon';
import type { AuthDto } from '../../common/auth.types';
import { MAIN_LIBRARY_ASSET_SQL, mainLibraryAssetWhere } from '../../common/asset-scope';
import { fromBytes, toBytes } from '../../common/bytes';
import type { AppConfig } from '../../config/configuration';
import { AlbumUserRole, AssetType, AssetVisibility, Prisma, UserStatus } from '../../db';
import { JOB, QUEUE } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { MachineLearningService } from '../../infra/ml/ml.service';
import { BULK_MUTATION_TRANSACTION } from '../../infra/prisma/bulk-mutation';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { DeviceService } from '../device/device.service';
import { FolderService } from '../folder/folder.service';
import { SubjectService } from '../person/subject.service';
import { UserService } from '../user/user.service';
import type {
  AssetQueryDto,
  BulkUpdateAssetsDto,
  ShareAssetsDto,
  UpdateAssetDto,
  UploadAssetDto,
} from './asset.dto';
import { AssetLifecycleService } from './asset-lifecycle.service';
import { assetLocations } from './asset-location';

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
export class AssetService implements OnModuleInit {
  private readonly logger = new Logger(AssetService.name);
  private readonly uploadLocks = new Map<string, Promise<void>>();
  private readonly deferredUploadBatches = new Map<
    string,
    { assetIds: Set<string>; timer: NodeJS.Timeout }
  >();
  private deferredRecoveryRunning = false;

  /** Long enough that large files can finish, short enough to recover a closed browser. */
  private static readonly DEFERRED_UPLOAD_TIMEOUT_MS = 30 * 60 * 1_000;
  private static readonly PROCESSING_QUEUE_BATCH_SIZE = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobService,
    private readonly folders: FolderService,
    private readonly devices: DeviceService,
    private readonly subjects: SubjectService,
    private readonly users: UserService,
    private readonly ml: MachineLearningService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly lifecycle: AssetLifecycleService,
  ) {}

  /**
   * Older builds hid the MOV half of every Live Photo, which made a successful
   * 299-file upload shrink after metadata processing. Restore every historical
   * motion file as an independent video and remove the obsolete pairing.
   */
  async onModuleInit() {
    const hiddenMotion = await this.prisma.asset.findMany({
      where: {
        type: AssetType.VIDEO,
        visibility: AssetVisibility.HIDDEN,
        deletedAt: null,
      },
      select: {
        id: true,
        isDeviceOnly: true,
        previewPath: true,
        jobStatus: { select: { metadataExtractedAt: true, thumbnailAt: true } },
      },
    });
    if (hiddenMotion.length === 0) return;

    const ids = hiddenMotion.map(({ id }) => id);
    await this.prisma.asset.updateMany({
      where: { livePhotoVideoId: { in: ids } },
      data: { livePhotoVideoId: null },
    });
    await this.prisma.asset.updateMany({
      where: { id: { in: ids }, visibility: AssetVisibility.HIDDEN },
      data: { visibility: AssetVisibility.TIMELINE },
    });

    const metadata = hiddenMotion.filter(({ jobStatus }) => !jobStatus?.metadataExtractedAt);
    const thumbnails = hiddenMotion.filter(
      ({ jobStatus }) => jobStatus?.metadataExtractedAt && !jobStatus.thumbnailAt,
    );
    const recognition = hiddenMotion.filter(
      ({ isDeviceOnly, previewPath, jobStatus }) =>
        !isDeviceOnly &&
        Boolean(previewPath) &&
        Boolean(jobStatus?.metadataExtractedAt) &&
        Boolean(jobStatus?.thumbnailAt),
    );

    await this.jobs.releaseJobIds(
      QUEUE.METADATA,
      JOB.EXTRACT_METADATA,
      metadata.map(({ id }) => id),
    );
    await this.jobs.enqueueMany(
      QUEUE.METADATA,
      JOB.EXTRACT_METADATA,
      metadata.map(({ id }) => ({ assetId: id })),
    );
    await this.jobs.releaseJobIds(
      QUEUE.VIDEO,
      JOB.GENERATE_THUMBNAILS,
      thumbnails.map(({ id }) => id),
    );
    await this.jobs.enqueueMany(
      QUEUE.VIDEO,
      JOB.GENERATE_THUMBNAILS,
      thumbnails.map(({ id }) => ({ assetId: id })),
    );

    if (this.ml.faceRecognitionEnabled && this.ml.videoRecognitionEnabled) {
      const recognitionIds = recognition.map(({ id }) => id);
      await this.jobs.releaseJobIds(QUEUE.FACE_DETECTION, JOB.DETECT_FACES, recognitionIds);
      await this.jobs.enqueueMany(
        QUEUE.FACE_DETECTION,
        JOB.DETECT_FACES,
        recognitionIds.map((assetId) => ({ assetId })),
        20,
      );
    }

    this.logger.log(`Restored ${hiddenMotion.length} hidden Live Photo video file(s)`);
  }

  // -- upload ---------------------------------------------------------------

  /**
   * Ingests one uploaded file.
   *
   * A web upload receipt is checked before hashing so a retry after a lost HTTP
   * response does not ingest the same request twice. The checksum lock then
   * serializes separate requests carrying the same bytes.
   */
  async createFromUpload(userId: string, file: UploadedFile, dto: UploadAssetDto) {
    if (dto.uploadId) {
      return this.withUploadLock(`receipt:${userId}:${dto.uploadId}`, async () => {
        const receipt = await this.findUploadReceipt(userId, dto.uploadId!);
        if (receipt) {
          await this.storage.remove(file.path);
          if (dto.albumId) await this.attachUploadToAlbum(userId, dto.albumId, receipt.id);
          if (dto.deferProcessing && dto.uploadBatchId) {
            this.deferAssetProcessing(userId, dto.uploadBatchId, receipt.id);
          }
          return { id: receipt.id, status: 'confirmed' as const };
        }
        return this.createFromNewUpload(userId, file, dto);
      });
    }

    return this.createFromNewUpload(userId, file, dto);
  }

  /**
   * Stores a tiny, untrusted browser preview only after validating its JPEG
   * header and dimensions. It never marks canonical processing as complete.
   */
  async storeBrowserThumbnail(userId: string, assetId: string, file: UploadedFile) {
    try {
      if (file.size > 1_000_000 || file.mimetype !== 'image/jpeg') {
        throw new BadRequestException('Browser thumbnail must be a JPEG smaller than 1 MB');
      }
      const metadata = await sharp(file.path, { failOn: 'error' }).metadata();
      if (
        metadata.format !== 'jpeg' ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > 1_024 ||
        metadata.height > 1_024
      ) {
        throw new BadRequestException('Browser thumbnail has invalid dimensions');
      }

      const asset = await this.prisma.asset.findFirst({
        where: { id: assetId, ownerId: userId, deletedAt: null },
        select: { id: true, thumbnailPath: true },
      });
      if (!asset) throw new NotFoundException('Asset not found');
      if (asset.thumbnailPath) return { stored: false, canonicalReady: true };

      const destination = this.storage.buildBrowserThumbnailPath(userId, assetId);
      await this.storage.remove(destination);
      const thumbnailPath = await this.storage.move(file.path, destination);
      const updated = await this.prisma.asset.updateMany({
        where: { id: assetId, ownerId: userId, deletedAt: null, thumbnailPath: null },
        data: { thumbnailPath },
      });
      if (updated.count === 0) await this.storage.remove(thumbnailPath);
      return { stored: updated.count === 1, canonicalReady: updated.count === 0 };
    } finally {
      await this.storage.remove(file.path);
    }
  }

  private async createFromNewUpload(userId: string, file: UploadedFile, dto: UploadAssetDto) {
    const checksum = await this.hashFile(file.path);
    // Every web selection has a fresh upload receipt and therefore represents
    // a new library item. A retry keeps that same receipt and is caught before
    // this method, while device backup still deduplicates repeated library scans.
    if (dto.uploadId) {
      return this.createFromHashedUpload(userId, file, dto, checksum);
    }

    const lockKey = `checksum:${userId}:${fromBytes(checksum).toString('hex')}`;
    return this.withUploadLock(lockKey, () =>
      this.createFromHashedUpload(userId, file, dto, checksum),
    );
  }

  private async createFromHashedUpload(
    userId: string,
    file: UploadedFile,
    dto: UploadAssetDto,
    checksum: Uint8Array<ArrayBuffer>,
  ) {
    const sourceDevice = await this.devices.register(userId, {
      clientId: dto.deviceId,
      assetId: dto.deviceAssetId,
      name: dto.deviceName,
      platform: dto.devicePlatform,
    });
    const originalFileName = dto.relativePath
      ? dto.relativePath.split(/[/\\]/).pop()!
      : file.originalname;
    const destinationFolderId = await this.resolveFolder(userId, dto);

    const duplicateSelect = {
      id: true,
      deletedAt: true,
      isDeviceOnly: true,
      folderId: true,
      folder: { select: { deletedAt: true } },
    } as const;

    // A retry is a duplicate only at the same logical location. Identical
    // files in two source folders are still two backed-up items and must keep
    // both names/locations. A deleted copy can be reused at a rebuilt path.
    let existing = dto.uploadId
      ? null
      : await this.prisma.asset.findFirst({
          where: {
            ownerId: userId,
            checksum,
            originalFileName,
            folderId: destinationFolderId,
          },
          select: duplicateSelect,
        });
    existing ??= dto.uploadId
      ? null
      : await this.prisma.asset.findFirst({
          where: {
            ownerId: userId,
            checksum,
            originalFileName,
            OR: [{ deletedAt: { not: null } }, { folder: { deletedAt: { not: null } } }],
          },
          select: duplicateSelect,
        });

    if (existing) {
      // The bytes are already here, but the requested destination still
      // matters. Re-uploading a deleted directory must rebuild its folder tree
      // instead of restoring assets underneath the old, deleted folder.
      await this.storage.remove(file.path);
      if (sourceDevice && dto.deviceAssetId) {
        await this.devices.recordAsset(sourceDevice.id, dto.deviceAssetId, existing.id);
      }

      if (dto.albumId) await this.attachUploadToAlbum(userId, dto.albumId, existing.id);

      const wasOrphaned = Boolean(existing.folder?.deletedAt);
      const promotedToPhotos = !sourceDevice && existing.isDeviceOnly;
      const folderChanged = destinationFolderId !== existing.folderId;

      if (existing.deletedAt || wasOrphaned || folderChanged || promotedToPhotos) {
        await this.prisma.asset.update({
          where: { id: existing.id },
          data: {
            deletedAt: null,
            status: 'ACTIVE',
            ...(promotedToPhotos ? { isDeviceOnly: false } : {}),
            // With no explicit destination, an asset restored from a deleted
            // folder becomes loose rather than remaining invisible there.
            folderId: folderChanged || wasOrphaned ? destinationFolderId : undefined,
          },
        });
        if (existing.deletedAt) {
          await this.subjects.refreshThumbnailsForAssets([existing.id]);
          await this.resumeAssetProcessing(userId, [existing.id]);
          return { id: existing.id, status: 'restored' as const };
        }
        return { id: existing.id, status: 'organized' as const };
      }

      return { id: existing.id, status: 'duplicate' as const };
    }

    await this.users.assertQuota(userId, file.size);

    const type = this.detectType(file.originalname, file.mimetype);
    const fileCreatedAt = dto.fileCreatedAt ? new Date(dto.fileCreatedAt) : new Date();
    const fileModifiedAt = dto.fileModifiedAt ? new Date(dto.fileModifiedAt) : fileCreatedAt;

    const asset = await this.prisma.asset.create({
      data: {
        ownerId: userId,
        type,
        // Points at the incoming file until the move below succeeds.
        originalPath: file.path,
        originalFileName,
        checksum,
        fileSizeInByte: BigInt(file.size),
        deviceAssetId: dto.deviceAssetId || null,
        deviceId: dto.deviceId || null,
        // The receipt identifies this request, not its bytes. Keeping it for a
        // deliberate duplicate prevents a lost response from creating it twice.
        uploadId: dto.uploadId || null,
        uploadBatchId: dto.uploadBatchId || null,
        fileCreatedAt,
        fileModifiedAt,
        // Refined once EXIF gives us the real capture time and timezone.
        localDateTime: fileCreatedAt,
        isFavorite: dto.isFavorite ?? false,
        isDeviceOnly: Boolean(sourceDevice),
        visibility: dto.isLocked ? AssetVisibility.LOCKED : AssetVisibility.TIMELINE,
        duration: dto.duration ?? null,
        folderId: destinationFolderId,
        jobStatus: { create: {} },
        deviceAssets:
          sourceDevice && dto.deviceAssetId
            ? { create: { deviceId: sourceDevice.id, deviceAssetId: dto.deviceAssetId } }
            : undefined,
      },
    });

    // Now that the id exists the storage template can be rendered.
    try {
      const destination = this.storage.buildOriginalPath({
        ownerId: userId,
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

    // Uploading from inside an album must not report success until the new
    // asset is actually a member. The old best-effort writes swallowed errors,
    // leaving a successful upload visible in Photos but missing from its album.
    if (dto.albumId) await this.attachUploadToAlbum(userId, dto.albumId, asset.id);

    await this.prisma.user.update({
      where: { id: userId },
      data: { quotaUsageInBytes: { increment: BigInt(file.size) } },
    });

    if (dto.deferProcessing && dto.uploadBatchId) {
      this.deferAssetProcessing(userId, dto.uploadBatchId, asset.id);
    } else {
      await this.jobs.onAssetUploaded(asset.id);
    }

    return { id: asset.id, status: 'created' as const };
  }

  /** One server process owns uploads, so a checksum-scoped queue closes the
   * duplicate check/create race without blocking unrelated media. */
  private async withUploadLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.uploadLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.uploadLocks.set(key, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.uploadLocks.get(key) === current) this.uploadLocks.delete(key);
    }
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
    if (!dto.folderId) return null;

    const folder = await this.folders.getById(userId, dto.folderId);
    if (folder.shared) throw new ForbiddenException('Shared folders are read-only');
    return folder.id;
  }

  private findUploadReceipt(userId: string, uploadId: string) {
    return this.prisma.asset.findFirst({
      where: { ownerId: userId, uploadId },
      select: { id: true },
    });
  }

  private async attachUploadToAlbum(userId: string, albumId: string, assetId: string) {
    const album = await this.prisma.album.findFirst({
      where: {
        id: albumId,
        deletedAt: null,
        OR: [
          { ownerId: userId },
          { albumUsers: { some: { userId, role: AlbumUserRole.EDITOR } } },
        ],
      },
      select: { id: true },
    });
    if (!album) throw new ForbiddenException('This album does not accept uploads from this account');

    await this.prisma.$transaction([
      this.prisma.albumAsset.createMany({
        data: [{ albumId, assetId, addedById: userId }],
        skipDuplicates: true,
      }),
      this.prisma.album.update({
        where: { id: albumId },
        data: { updatedAt: new Date() },
      }),
    ]);
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

  /** One lightweight query replaces a thumbnail request loop for every tile. */
  async thumbnailStatus(userId: string, ids: string[]) {
    const assets = await this.prisma.asset.findMany({
      where: {
        id: { in: [...new Set(ids)] },
        ownerId: userId,
        deletedAt: null,
      },
      select: { id: true, thumbnailPath: true },
    });
    return {
      readyIds: assets.filter((asset) => Boolean(asset.thumbnailPath)).map((asset) => asset.id),
    };
  }

  /** Confirms committed web uploads after a client lost the success response. */
  async checkUploadReceipts(
    userId: string,
    uploadIds: string[],
    options: { batchId?: string; deferProcessing?: boolean } = {},
  ) {
    const uniqueIds = [...new Set(uploadIds)];
    const assets = await this.prisma.asset.findMany({
      where: { ownerId: userId, uploadId: { in: uniqueIds } },
      select: {
        id: true,
        uploadId: true,
        deletedAt: true,
        folder: { select: { deletedAt: true } },
        jobStatus: { select: { metadataExtractedAt: true } },
      },
    });
    const unprocessed = assets.filter(
      (asset) =>
        !asset.deletedAt && !asset.folder?.deletedAt && !asset.jobStatus?.metadataExtractedAt,
    );
    if (options.deferProcessing && options.batchId) {
      for (const asset of unprocessed) {
        this.deferAssetProcessing(userId, options.batchId, asset.id);
      }
    } else {
      await this.queueStoredAssetProcessing(
        userId,
        unprocessed.map((asset) => asset.id),
      );
    }
    const byUploadId = new Map(
      assets
        .filter((asset) => asset.uploadId)
        .map((asset) => [asset.uploadId!, asset.id]),
    );
    return uploadIds.map((uploadId) => ({
      uploadId,
      assetId: byUploadId.get(uploadId) ?? null,
      exists: byUploadId.has(uploadId),
    }));
  }

  /** Marks the storage phase complete and starts the normal processing pipeline in bulk. */
  async completeUploadBatch(userId: string, batchId: string, assetIds: string[]) {
    const key = this.deferredBatchKey(userId, batchId);
    const deferred = this.deferredUploadBatches.get(key);
    if (deferred) {
      clearTimeout(deferred.timer);
      this.deferredUploadBatches.delete(key);
    }

    const queued = await this.queueStoredAssetProcessing(
      userId,
      [...new Set([...(deferred?.assetIds ?? []), ...assetIds])],
      batchId,
    );
    return { stored: new Set(assetIds).size, queued };
  }

  private deferAssetProcessing(userId: string, batchId: string, assetId: string) {
    const key = this.deferredBatchKey(userId, batchId);
    const existing = this.deferredUploadBatches.get(key);
    if (existing) clearTimeout(existing.timer);

    const assetIds = existing?.assetIds ?? new Set<string>();
    assetIds.add(assetId);
    const timer = setTimeout(() => {
      this.deferredUploadBatches.delete(key);
      void this.queueStoredAssetProcessing(userId, [...assetIds], batchId).catch((error: unknown) => {
        this.logger.warn(
          `Deferred upload batch ${batchId} could not start processing: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, AssetService.DEFERRED_UPLOAD_TIMEOUT_MS) as unknown as NodeJS.Timeout;
    timer.unref();
    this.deferredUploadBatches.set(key, { assetIds, timer });
  }

  private deferredBatchKey(userId: string, batchId: string) {
    return `${userId}:${batchId}`;
  }

  private async queueStoredAssetProcessing(userId: string, assetIds: string[], batchId?: string) {
    const ids = [...new Set(assetIds)];
    if (ids.length === 0) return 0;

    if (batchId) {
      await this.prisma.asset.updateMany({
        where: { id: { in: ids }, ownerId: userId },
        data: { uploadBatchId: batchId },
      });
      await this.prisma.recognitionBatch.upsert({
        where: { ownerId_id: { ownerId: userId, id: batchId } },
        create: { ownerId: userId, id: batchId },
        update: { completedAt: null },
      });
    }

    const assets = await this.prisma.asset.findMany({
      where: {
        id: { in: ids },
        ownerId: userId,
        deletedAt: null,
        OR: [{ jobStatus: null }, { jobStatus: { metadataExtractedAt: null } }],
      },
      select: { id: true, type: true },
    });
    // A batch can contain multi-gigabyte videos beside small photos. Queue the
    // photos first so their metadata and previews become visible immediately;
    // video posters then continue on their own worker.
    const pendingIds = assets
      .sort(
        (left, right) =>
          Number(left.type === AssetType.VIDEO) - Number(right.type === AssetType.VIDEO),
      )
      .map(({ id }) => id);

    for (let index = 0; index < pendingIds.length; index += AssetService.PROCESSING_QUEUE_BATCH_SIZE) {
      const batch = pendingIds.slice(index, index + AssetService.PROCESSING_QUEUE_BATCH_SIZE);
      await this.jobs.releaseJobIds(QUEUE.METADATA, JOB.EXTRACT_METADATA, batch);
      await this.jobs.enqueueMany(
        QUEUE.METADATA,
        JOB.EXTRACT_METADATA,
        batch.map((assetId) => ({ assetId })),
      );
    }
    return pendingIds.length;
  }

  /** Restarts only the incomplete stages of assets brought back from Trash. */
  private async resumeAssetProcessing(userId: string, assetIds: string[]) {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: [...new Set(assetIds)] }, ownerId: userId, deletedAt: null },
      select: {
        id: true,
        type: true,
        visibility: true,
        jobStatus: true,
      },
    });
    const metadata = assets.filter(({ jobStatus }) => !jobStatus?.metadataExtractedAt);
    const thumbnails = assets.filter(
      ({ jobStatus }) => jobStatus?.metadataExtractedAt && !jobStatus.thumbnailAt,
    );
    const ready = assets.filter(({ jobStatus }) => Boolean(jobStatus?.thumbnailAt));

    await this.enqueueMissingStage(
      QUEUE.METADATA,
      JOB.EXTRACT_METADATA,
      metadata.map(({ id }) => id),
    );
    await this.enqueueMissingStage(
      QUEUE.THUMBNAIL,
      JOB.GENERATE_THUMBNAILS,
      thumbnails.filter(({ type }) => type !== AssetType.VIDEO).map(({ id }) => id),
    );
    await this.enqueueMissingStage(
      QUEUE.VIDEO,
      JOB.GENERATE_THUMBNAILS,
      thumbnails.filter(({ type }) => type === AssetType.VIDEO).map(({ id }) => id),
    );
    await this.enqueueMissingStage(
      QUEUE.VIDEO,
      JOB.TRANSCODE_VIDEO,
      ready
        .filter(({ type, jobStatus }) => type === AssetType.VIDEO && !jobStatus?.videoEncodedAt)
        .map(({ id }) => id),
    );

    if (this.config.get('duplicates.enabled', { infer: true })) {
      await this.enqueueMissingStage(
        QUEUE.DUPLICATE,
        JOB.DETECT_DUPLICATES,
        ready.filter(({ jobStatus }) => !jobStatus?.duplicatesDetectedAt).map(({ id }) => id),
      );
    }
    if (this.config.get('machineLearning.enabled', { infer: true })) {
      await this.enqueueMissingStage(
        QUEUE.SMART_SEARCH,
        JOB.ENCODE_CLIP,
        ready
          .filter(
            ({ visibility, jobStatus }) =>
              visibility !== AssetVisibility.LOCKED &&
              visibility !== AssetVisibility.HIDDEN &&
              !jobStatus?.smartSearchAt,
          )
          .map(({ id }) => id),
      );
    }
    if (this.ml.faceRecognitionEnabled) {
      const recognition = ready.filter(
        ({ type, visibility, jobStatus }) =>
          visibility !== AssetVisibility.LOCKED &&
          visibility !== AssetVisibility.HIDDEN &&
          (type !== AssetType.VIDEO || this.ml.videoRecognitionEnabled) &&
          (!jobStatus?.facesRecognizedAt || !jobStatus.petsRecognizedAt),
      );
      await this.enqueueMissingStage(
        QUEUE.FACE_DETECTION,
        JOB.DETECT_FACES,
        recognition.map(({ id }) => id),
      );
    }
  }

  private async enqueueMissingStage(
    queue: (typeof QUEUE)[keyof typeof QUEUE],
    job: string,
    assetIds: string[],
  ) {
    for (let index = 0; index < assetIds.length; index += AssetService.PROCESSING_QUEUE_BATCH_SIZE) {
      const batch = assetIds.slice(index, index + AssetService.PROCESSING_QUEUE_BATCH_SIZE);
      await this.jobs.releaseJobIds(queue, job, batch);
      await this.jobs.enqueueMany(
        queue,
        job,
        batch.map((assetId) => ({ assetId })),
      );
    }
  }

  private forgetDeferredAssetProcessing(assetIds: string[]) {
    const removed = new Set(assetIds);
    for (const [key, deferred] of this.deferredUploadBatches) {
      for (const assetId of removed) deferred.assetIds.delete(assetId);
      if (deferred.assetIds.size > 0) continue;
      clearTimeout(deferred.timer);
      this.deferredUploadBatches.delete(key);
    }
  }

  /** Recovers browser batches that vanished before sending upload-complete. */
  @Interval(60_000)
  async resumeInterruptedUploadBatches() {
    if (this.deferredRecoveryRunning) return;
    this.deferredRecoveryRunning = true;
    try {
      const assets = await this.prisma.asset.findMany({
        where: {
          uploadId: { not: null },
          deletedAt: null,
          createdAt: {
            lte: new Date(Date.now() - AssetService.DEFERRED_UPLOAD_TIMEOUT_MS),
          },
          OR: [{ jobStatus: null }, { jobStatus: { metadataExtractedAt: null } }],
        },
        select: { id: true, ownerId: true, uploadBatchId: true },
        take: AssetService.PROCESSING_QUEUE_BATCH_SIZE,
      });
      const byOwnerAndBatch = new Map<string, typeof assets>();
      for (const asset of assets) {
        const key = `${asset.ownerId}:${asset.uploadBatchId ?? ''}`;
        const ownerAssets = byOwnerAndBatch.get(key) ?? [];
        ownerAssets.push(asset);
        byOwnerAndBatch.set(key, ownerAssets);
      }
      for (const ownerAssets of byOwnerAndBatch.values()) {
        const { ownerId, uploadBatchId } = ownerAssets[0];
        await this.queueStoredAssetProcessing(
          ownerId,
          ownerAssets.map(({ id }) => id),
          uploadBatchId ?? undefined,
        );
      }
    } finally {
      this.deferredRecoveryRunning = false;
    }
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
        albums: {
          where: { album: { deletedAt: null } },
          select: {
            albumId: true,
            album: {
              select: {
                name: true,
                folderId: true,
                folder: { select: { path: true } },
              },
            },
          },
        },
        deviceAssets: { select: { device: { select: { name: true } } } },
      },
    });

    if (!asset || asset.deletedAt) throw new NotFoundException('Asset not found');
    await this.assertCanRead(auth, asset);

    const { deviceAssets, albums, ...rest } = asset;
    if (asset.ownerId !== auth.user.id) {
      return {
        ...rest,
        albums: albums.map(({ albumId }) => ({ albumId })),
        locations: [{ kind: 'shared' as const, label: 'Shared with me' }],
      };
    }

    const folderIds = new Set(
      [asset.folder?.path, ...albums.map(({ album }) => album.folder?.path)]
        .flatMap((path) => path?.split('/').filter(Boolean) ?? []),
    );
    const folders = await this.prisma.folder.findMany({
      where: { id: { in: [...folderIds] }, ownerId: asset.ownerId, deletedAt: null },
      select: { id: true, name: true, parentId: true },
    });

    return {
      ...rest,
      albums: albums.map(({ albumId }) => ({ albumId })),
      locations: assetLocations(
        {
          folder: asset.folder,
          albums,
          deviceAssets,
          isDeviceOnly: asset.isDeviceOnly,
          visibility: asset.visibility,
        },
        folders,
      ),
    };
  }

  /**
   * Read access is: you own it, it was directly shared with you, a partner
   * shared their library with you, it is in an album shared with you, or the
   * share key names it.
   */
  private async assertCanRead(
    auth: AuthDto,
    asset: { id: string; ownerId: string; folderId?: string | null; visibility: AssetVisibility },
  ) {
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
          throw new ForbiddenException({ message: 'Locked folders are locked', code: 'VAULT_LOCKED' });
        }
      }
      return;
    }

    // A vault lock is stronger than every sharing mechanism. Do this before
    // consulting direct shares so a record left behind by an interrupted lock
    // operation can never expose the protected file.
    if (asset.visibility === AssetVisibility.LOCKED) {
      throw new ForbiddenException('Locked photos cannot be shared');
    }

    const [directShare, partner, sharedAlbum, sharedFolder] = await Promise.all([
      this.prisma.assetUser.findUnique({
        where: { assetId_userId: { assetId: asset.id, userId: auth.user.id } },
      }),
      this.prisma.partner.findUnique({
        where: { sharedById_sharedWithId: { sharedById: asset.ownerId, sharedWithId: auth.user.id } },
      }),
      this.prisma.albumAsset.findFirst({
        where: { assetId: asset.id, album: { albumUsers: { some: { userId: auth.user.id } } } },
      }),
      asset.folderId
        ? this.prisma.$queryRaw<{ allowed: boolean }[]>`
            SELECT EXISTS (
              SELECT 1
              FROM folders target
              JOIN folder_users fu ON fu."userId" = ${auth.user.id}::uuid
              JOIN folders root ON root.id = fu."folderId"
              WHERE target.id = ${asset.folderId}::uuid
                AND target."deletedAt" IS NULL
                AND target."isLocked" = false
                AND root."deletedAt" IS NULL
                AND root."isLocked" = false
                AND target.path LIKE root.path || '%'
            ) AS allowed
          `.then((rows) => rows[0]?.allowed ?? false)
        : Promise.resolve(false),
    ]);

    if (!directShare && !partner && !sharedAlbum && !sharedFolder) {
      throw new ForbiddenException('You do not have access to this photo');
    }
  }

  /** Shares selected, non-locked assets with existing accounts as read-only. */
  async share(userId: string, dto: ShareAssetsDto) {
    const assetIds = [...new Set(dto.ids)];
    const recipientIds = [...new Set(dto.userIds)].filter((id) => id !== userId);
    if (!assetIds.length || !recipientIds.length) {
      throw new BadRequestException('Choose at least one photo and one other account');
    }

    const [assets, recipients] = await Promise.all([
      this.prisma.asset.findMany({
        where: { id: { in: assetIds }, ...mainLibraryAssetWhere(userId) },
        select: { id: true, visibility: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: recipientIds }, status: UserStatus.ACTIVE, deletedAt: null },
        select: { id: true, name: true, email: true },
      }),
    ]);

    if (assets.length !== assetIds.length) throw new NotFoundException('One or more photos were not found');
    if (assets.some((asset) => asset.visibility === AssetVisibility.LOCKED)) {
      throw new ForbiddenException('Locked photos cannot be shared');
    }
    if (recipients.length !== recipientIds.length) {
      throw new NotFoundException('One or more accounts were not found');
    }

    await this.prisma.assetUser.createMany({
      data: assetIds.flatMap((assetId) => recipientIds.map((recipientId) => ({ assetId, userId: recipientId }))),
      skipDuplicates: true,
    });

    return { assetCount: assetIds.length, recipients };
  }

  async sharedWith(userId: string, assetId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, ownerId: userId, deletedAt: null } });
    if (!asset) throw new NotFoundException('Asset not found');
    return this.prisma.assetUser.findMany({
      where: { assetId },
      select: { user: { select: { id: true, name: true, email: true, profileImagePath: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async removeShare(userId: string, assetId: string, recipientId: string) {
    const { count } = await this.prisma.assetUser.deleteMany({
      where: { assetId, userId: recipientId, asset: { ownerId: userId } },
    });
    if (!count) throw new NotFoundException('Share not found');
  }

  buildWhere(userId: string, query: AssetQueryDto): Prisma.AssetWhereInput {
    const ownership = query.ownership ?? 'owned';
    const accessibleAssets: Prisma.AssetWhereInput =
      ownership === 'shared'
        ? { ownerId: { not: userId }, sharedWith: { some: { userId } } }
        : ownership === 'all'
          ? { OR: [{ ownerId: userId }, { sharedWith: { some: { userId } } }] }
          : { ownerId: userId };

    return {
      AND: [
        accessibleAssets,
        {
      deletedAt: null,
      visibility: query.visibility ?? AssetVisibility.TIMELINE,
      type: query.type,
      isFavorite: query.isFavorite,
      folderId: query.folderId,
      ...(query.albumId ? { albums: { some: { albumId: query.albumId } } } : {}),
      ...(query.deviceId
        ? { deviceAssets: { some: { deviceId: query.deviceId } } }
        : { isDeviceOnly: false }),
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
      ...((query.subjectIds ?? query.personIds)?.length
        ? {
            // Every selected subject must appear, not just one of them.
            AND: (query.subjectIds ?? query.personIds)!.map((subjectId) => ({
              faces: { some: { personId: subjectId, deletedAt: null } },
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
      ...(query.notInFolder ? { folderId: null } : {}),
      ...(query.withPeople ? { faces: { some: { personId: { not: null }, deletedAt: null } } } : {}),
        },
      ],
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
        ${MAIN_LIBRARY_ASSET_SQL}
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
        ...mainLibraryAssetWhere(userId),
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
        ${MAIN_LIBRARY_ASSET_SQL}
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
        ${MAIN_LIBRARY_ASSET_SQL}
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
        asset: mainLibraryAssetWhere(userId),
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
  async backedUpDeviceAssetIds(userId: string, deviceId?: string): Promise<string[]> {
    if (deviceId) return this.devices.backedUpAssetIds(userId, deviceId);

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
           AND a."isDeviceOnly" = false
           AND a.visibility IN ('TIMELINE', 'ARCHIVE')
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
        ${MAIN_LIBRARY_ASSET_SQL}
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
        where: mainLibraryAssetWhere(userId),
      }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM smart_search s
        JOIN assets a ON a.id = s."assetId"
        WHERE a."ownerId" = ${userId}::uuid
          ${MAIN_LIBRARY_ASSET_SQL}
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
      this.prisma.asset.count({ where: { ownerId: userId, type: 'IMAGE', isDeviceOnly: false, deletedAt: null } }),
      this.prisma.asset.count({ where: { ownerId: userId, type: 'VIDEO', isDeviceOnly: false, deletedAt: null } }),
      this.prisma.asset.count({ where: { ownerId: userId, isFavorite: true, isDeviceOnly: false, deletedAt: null } }),
      this.prisma.asset.count({ where: { ownerId: userId, deletedAt: { not: null } } }),
      this.prisma.asset.count({ where: { ownerId: userId, visibility: 'ARCHIVE', isDeviceOnly: false, deletedAt: null } }),
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
        originalFileName: dto.originalFileName
          ? this.renamePreservingExtension(asset.originalFileName, dto.originalFileName)
          : undefined,
        isFavorite: dto.isFavorite,
        rotation: dto.rotation,
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

  /** The media format is immutable metadata, not part of its editable display name. */
  private renamePreservingExtension(currentName: string, requestedName: string) {
    const originalExtension = extname(currentName);
    const trimmed = requestedName.trim();
    if (!originalExtension) return trimmed;

    const requestedExtension = extname(trimmed);
    const base = requestedExtension ? trimmed.slice(0, -requestedExtension.length) : trimmed;
    return `${base}${originalExtension}`;
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
    const uniqueIds = [...new Set(ids)];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: uniqueIds }, ownerId: userId, deletedAt: null },
      select: { id: true, livePhotoVideoId: true },
    });
    const affectedIds = [
      ...new Set(
        assets.flatMap((asset) => [asset.id, ...(asset.livePhotoVideoId ? [asset.livePhotoVideoId] : [])]),
      ),
    ];
    const [trashed, removedShares] = await this.prisma.$transaction([
      this.prisma.asset.updateMany({
        where: { id: { in: affectedIds } },
        data: { deletedAt: new Date(), status: 'TRASHED' },
      }),
      // Shared photos are read-only: removing one from the recipient's library
      // revokes their direct share without touching the owner's copy.
      this.prisma.assetUser.deleteMany({
        where: { assetId: { in: uniqueIds }, userId },
      }),
    ], BULK_MUTATION_TRANSACTION);
    this.forgetDeferredAssetProcessing(affectedIds);
    await this.jobs.cancelAssetProcessing(affectedIds).catch((error) =>
      this.logger.warn(`Could not cancel processing for trashed assets: ${String(error)}`),
    );
    // Cover regeneration is cleanup, not part of moving the asset to Trash.
    // A bad historical crop must not turn a successful delete into HTTP 500.
    this.lifecycle.refreshThumbnailsForAssets(affectedIds);
    return { trashed: trashed.count, removedShares: removedShares.count };
  }

  async restore(userId: string, ids: string[]) {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: ids }, ownerId: userId, deletedAt: { not: null } },
      select: {
        id: true,
        livePhotoVideoId: true,
        folderId: true,
        folder: { select: { deletedAt: true } },
      },
    });
    const restoredFromFolders: string[] = [];
    const deletedFolderIds = [
      ...new Set(
        assets
          .filter((asset) => asset.folder?.deletedAt && asset.folderId)
          .map((asset) => asset.folderId!),
      ),
    ];
    for (const folderId of deletedFolderIds) {
      const restored = await this.folders.restore(userId, folderId);
      if ('restoredAssetIds' in restored) restoredFromFolders.push(...restored.restoredAssetIds);
    }

    const affectedIds = [
      ...new Set([
        ...assets.flatMap((asset) => [
          asset.id,
          ...(asset.livePhotoVideoId ? [asset.livePhotoVideoId] : []),
        ]),
        ...restoredFromFolders,
      ]),
    ];
    await this.prisma.asset.updateMany({
      where: { id: { in: affectedIds }, deletedAt: { not: null } },
      data: { deletedAt: null, status: 'ACTIVE' },
    });
    await this.resumeAssetProcessing(userId, affectedIds);
    this.lifecycle.refreshThumbnailsForAssets(affectedIds);
    return { restored: affectedIds.length };
  }

  async restoreAll(userId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { ownerId: userId, deletedAt: { not: null } },
      select: { id: true, folderId: true, folder: { select: { deletedAt: true } } },
    });
    const deletedFolderIds = [
      ...new Set(
        assets
          .filter((asset) => asset.folder?.deletedAt && asset.folderId)
          .map((asset) => asset.folderId!),
      ),
    ];
    for (const folderId of deletedFolderIds) await this.folders.restore(userId, folderId);

    await this.prisma.asset.updateMany({
      where: { ownerId: userId, deletedAt: { not: null } },
      data: { deletedAt: null, status: 'ACTIVE' },
    });
    const affectedIds = assets.map((asset) => asset.id);
    await this.resumeAssetProcessing(userId, affectedIds);
    this.lifecycle.refreshThumbnailsForAssets(affectedIds);
    return { restored: affectedIds.length };
  }

  async listTrash(userId: string, page = 1, size = 250) {
    const retentionDays = this.config.get('trash.retentionDays', { infer: true });
    const offset = (Math.max(1, page) - 1) * size;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id
      FROM assets a
      LEFT JOIN folders f ON f.id = a."folderId"
      WHERE a."ownerId" = ${userId}::uuid
        AND a."deletedAt" IS NOT NULL
        AND a.visibility <> 'HIDDEN'
        AND (a."folderId" IS NULL OR f."deletedAt" IS NULL)
        AND NOT EXISTS (
          SELECT 1
          FROM album_assets aa
          JOIN albums al ON al.id = aa."albumId"
          WHERE aa."assetId" = a.id
            AND al."ownerId" = ${userId}::uuid
            AND al."deletedAt" = a."deletedAt"
        )
      ORDER BY a."deletedAt" DESC
      OFFSET ${offset}
      LIMIT ${size}
    `;
    const items = await this.prisma.asset.findMany({
      where: { id: { in: rows.map((row) => row.id) }, ownerId: userId },
      include: { exif: true },
    });
    const byId = new Map(items.map((asset) => [asset.id, asset]));

    return rows.flatMap(({ id }) => {
      const asset = byId.get(id);
      if (!asset) return [];
      return [{
        ...asset,
        // Surfacing the deadline is what makes the trash feel safe to use.
        purgeAt: new Date(asset.deletedAt!.getTime() + retentionDays * 86_400_000),
      }];
    });
  }

  /** Removes the database rows and every file on disk. Irreversible. */
  async deletePermanently(userId: string, ids: string[]) {
    return this.lifecycle.deletePermanently(userId, ids);
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
    if (!asset) throw new NotFoundException('Asset not found');
    if (
      asset.deletedAt &&
      (asset.ownerId !== auth.user.id || auth.sharedLink || !['thumbnail', 'preview'].includes(size))
    ) {
      throw new NotFoundException('Asset not found');
    }
    await this.assertCanRead(auth, asset);

    if (auth.sharedLink && size === 'original' && !auth.sharedLink.allowDownload) {
      throw new ForbiddenException('Downloads are disabled for this link');
    }

    // A video original cannot render in an <img>. Returning a MOV while its
    // poster is processing made browsers cache a permanent broken thumbnail.
    const imageFallback = asset.type === AssetType.VIDEO ? [] : [asset.originalPath];
    const candidates: Record<typeof size, (string | null)[]> = {
      thumbnail: [asset.thumbnailPath, asset.previewPath, ...imageFallback],
      preview: [asset.previewPath, asset.thumbnailPath, ...imageFallback],
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
