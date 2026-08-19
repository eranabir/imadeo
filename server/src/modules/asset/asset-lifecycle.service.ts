import { Injectable, Logger } from '@nestjs/common';
import type { Asset } from '../../db';
import { BackgroundTaskGate } from '../../infra/job/background-task-gate.service';
import {
  BULK_MUTATION_BATCH_SIZE,
  BULK_MUTATION_TRANSACTION,
  batchesOf,
} from '../../infra/prisma/bulk-mutation';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { SubjectService } from '../person/subject.service';

/** Shared asset cleanup used by photo, album and folder Trash operations. */
@Injectable()
export class AssetLifecycleService {
  private readonly logger = new Logger(AssetLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly subjects: SubjectService,
    private readonly backgroundTasks: BackgroundTaskGate,
  ) {}

  refreshThumbnailsForAssets(assetIds: string[]) {
    const uniqueIds = [...new Set(assetIds)];
    if (uniqueIds.length === 0) return;

    // Covers are derived data. Queue their sharp work behind the same global
    // resource policy and let the interactive delete/restore request finish.
    void this.backgroundTasks
      .runMediaProcessing(() => this.subjects.refreshThumbnailsForAssets(uniqueIds))
      .catch((error) =>
        this.logger.warn(`Could not refresh People & Pets covers: ${String(error)}`),
      );
  }

  /** Removes trashed database rows and every corresponding file on disk. */
  async deletePermanently(userId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const assets: Pick<
      Asset,
      | 'id'
      | 'livePhotoVideoId'
      | 'originalPath'
      | 'thumbnailPath'
      | 'previewPath'
      | 'encodedVideoPath'
      | 'fileSizeInByte'
    >[] = [];
    for (const idBatch of batchesOf(uniqueIds, 1_000)) {
      assets.push(
        ...(await this.prisma.asset.findMany({
          where: { id: { in: idBatch }, ownerId: userId, deletedAt: { not: null } },
          select: {
            id: true,
            livePhotoVideoId: true,
            originalPath: true,
            thumbnailPath: true,
            previewPath: true,
            encodedVideoPath: true,
            fileSizeInByte: true,
          },
        })),
      );
    }

    const companionIds = assets.flatMap(({ livePhotoVideoId }) =>
      livePhotoVideoId ? [livePhotoVideoId] : [],
    );
    const companions = companionIds.length
      ? await this.prisma.asset.findMany({
          where: {
            id: { in: companionIds },
            ownerId: userId,
            visibility: 'HIDDEN',
          },
          select: {
            id: true,
            livePhotoVideoId: true,
            originalPath: true,
            thumbnailPath: true,
            previewPath: true,
            encodedVideoPath: true,
            fileSizeInByte: true,
          },
        })
      : [];
    const allAssets = [
      ...assets,
      ...companions.filter((companion) => !assets.some(({ id }) => id === companion.id)),
    ];

    const assetIds = allAssets.map((asset) => asset.id);
    let freedBytes = 0n;

    // Cascading thousands of face, album, job, and search rows can exceed
    // Prisma's five-second default on a busy NAS. Bounded transactions keep
    // each commit manageable, while the explicit timeout tolerates slower
    // disks and concurrent background processing.
    for (const batch of batchesOf(allAssets, BULK_MUTATION_BATCH_SIZE)) {
      const batchIds = batch.map((asset) => asset.id);
      const batchBytes = batch.reduce((sum, asset) => sum + asset.fileSizeInByte, 0n);

      await this.prisma.$transaction([
        this.prisma.asset.deleteMany({
          // The requested rows were selected from Trash above. Their hidden
          // Live Photo companions are part of that same logical media item even
          // in databases created before companions were trashed together.
          where: { id: { in: batchIds }, ownerId: userId },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { quotaUsageInBytes: { decrement: batchBytes } },
        }),
      ], BULK_MUTATION_TRANSACTION);

      // Database first: if a transaction fails, every original remains
      // restorable. A later disk cleanup failure is safe because removeMany
      // logs it and leaves only an orphan file, never a broken Trash item.
      await this.storage.removeMany(
        batch.flatMap((asset) => [
          asset.originalPath,
          asset.thumbnailPath,
          asset.previewPath,
          asset.encodedVideoPath,
        ]),
      );
      freedBytes += batchBytes;
    }

    this.refreshThumbnailsForAssets(assetIds);

    return { deleted: allAssets.length, freedBytes };
  }
}
