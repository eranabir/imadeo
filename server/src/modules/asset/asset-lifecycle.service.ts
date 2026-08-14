import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { SubjectService } from '../person/subject.service';

/** Shared asset cleanup used by photo, album and folder Trash operations. */
@Injectable()
export class AssetLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly subjects: SubjectService,
  ) {}

  refreshThumbnailsForAssets(assetIds: string[]) {
    return this.subjects.refreshThumbnailsForAssets(assetIds);
  }

  /** Removes trashed database rows and every corresponding file on disk. */
  async deletePermanently(userId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: uniqueIds }, ownerId: userId, deletedAt: { not: null } },
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

    const assetIds = assets.map((asset) => asset.id);
    const freedBytes = assets.reduce((sum, asset) => sum + asset.fileSizeInByte, 0n);
    await this.prisma.$transaction([
      this.prisma.asset.deleteMany({
        where: { id: { in: assetIds }, ownerId: userId, deletedAt: { not: null } },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { quotaUsageInBytes: { decrement: freedBytes } },
      }),
    ]);
    await this.subjects.refreshThumbnailsForAssets(assetIds);

    return { deleted: assets.length, freedBytes };
  }
}
