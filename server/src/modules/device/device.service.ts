import { Injectable, NotFoundException } from '@nestjs/common';
import { AssetVisibility } from '../../db';
import { BULK_MUTATION_BATCH_SIZE, batchesOf } from '../../infra/prisma/bulk-mutation';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AssetLifecycleService } from '../asset/asset-lifecycle.service';

export interface BackupDeviceInput {
  clientId?: string;
  assetId?: string;
  name?: string;
  platform?: string;
}

@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetLifecycle: AssetLifecycleService,
  ) {}

  /**
   * Registers the mobile library and returns its database id.
   *
   * A client id names the installation, while the human name is free to
   * improve as newer app builds begin sending it.
   */
  async register(userId: string, input: BackupDeviceInput) {
    if (!input.clientId || !input.assetId) return null;

    const name = input.name?.trim().slice(0, 120);
    const platform = input.platform?.trim().slice(0, 40);
    return this.prisma.device.upsert({
      where: { ownerId_clientId: { ownerId: userId, clientId: input.clientId } },
      create: {
        ownerId: userId,
        clientId: input.clientId,
        name: name || 'Mobile device',
        platform: platform || '',
        lastSeenAt: new Date(),
      },
      update: {
        name: name || undefined,
        platform: platform || undefined,
        lastSeenAt: new Date(),
      },
    });
  }

  /** Adds one OS-library item to a device without duplicating its file. */
  async recordAsset(deviceId: string, deviceAssetId: string, assetId: string) {
    return this.prisma.deviceAsset.upsert({
      where: { deviceId_deviceAssetId: { deviceId, deviceAssetId } },
      create: { deviceId, deviceAssetId, assetId },
      update: { assetId },
    });
  }

  async list(userId: string) {
    const devices = await this.prisma.device.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        clientId: true,
        name: true,
        platform: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            assets: {
              where: {
                asset: {
                  deletedAt: null,
                  visibility: AssetVisibility.TIMELINE,
                  isDeviceOnly: true,
                },
              },
            },
          },
        },
        assets: {
          where: {
            asset: {
              deletedAt: null,
              visibility: AssetVisibility.TIMELINE,
              isDeviceOnly: true,
            },
          },
          orderBy: { asset: { localDateTime: 'desc' } },
          take: 1,
          select: { assetId: true },
        },
      },
      orderBy: { lastSeenAt: 'desc' },
    });

    return devices.map(({ _count, assets, ...device }) => ({
      ...device,
      libraryName: `${device.name} Library`,
      assetCount: _count.assets,
      coverAssetId: assets[0]?.assetId ?? null,
    }));
  }

  async get(userId: string, id: string) {
    const device = (await this.list(userId)).find((entry) => entry.id === id);
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  /** Moves the complete device library to Trash, then removes its association. */
  async remove(userId: string, id: string) {
    const device = await this.prisma.device.findFirst({
      where: { id, ownerId: userId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException('Device not found');

    const linkedAssets = await this.prisma.deviceAsset.findMany({
      where: {
        deviceId: id,
        asset: { ownerId: userId, deletedAt: null, isDeviceOnly: true },
      },
      select: { assetId: true },
    });
    let trashedAssets = 0;
    for (const batch of batchesOf(linkedAssets.map(({ assetId }) => assetId), BULK_MUTATION_BATCH_SIZE)) {
      const result = await this.assetLifecycle.moveToTrash(userId, batch);
      trashedAssets += result.trashed;
    }

    const result = await this.prisma.device.deleteMany({ where: { id, ownerId: userId } });
    if (result.count === 0) throw new NotFoundException('Device not found');
    return { deleted: true, trashedAssets };
  }

  /** OS asset ids already represented in this particular mobile library. */
  async backedUpAssetIds(userId: string, clientId: string) {
    const device = await this.prisma.device.findUnique({
      where: { ownerId_clientId: { ownerId: userId, clientId } },
      select: { id: true },
    });
    if (!device) return [];

    const rows = await this.prisma.deviceAsset.findMany({
      where: { deviceId: device.id, asset: { deletedAt: null } },
      select: { deviceAssetId: true },
    });
    return rows.map((row) => row.deviceAssetId);
  }
}
