import { Injectable, NotFoundException } from '@nestjs/common';
import { AssetVisibility } from '../../db';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface BackupDeviceInput {
  clientId?: string;
  assetId?: string;
  name?: string;
  platform?: string;
}

@Injectable()
export class DeviceService {
  constructor(private readonly prisma: PrismaService) {}

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
        name: true,
        platform: true,
        lastSeenAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            assets: {
              where: {
                asset: { deletedAt: null, visibility: AssetVisibility.TIMELINE },
              },
            },
          },
        },
        assets: {
          where: { asset: { deletedAt: null, visibility: AssetVisibility.TIMELINE } },
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
