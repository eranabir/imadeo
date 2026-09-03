import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DeviceService } from './device.service';

describe('DeviceService.list', () => {
  it('counts and covers only media that has not been moved into the main library', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new DeviceService(
      { device: { findMany } } as never,
      {} as never,
    );

    await service.list('owner-id');

    const visibleAsset = {
      deletedAt: null,
      visibility: 'TIMELINE',
      isDeviceOnly: true,
    };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        clientId: true,
        _count: { select: { assets: { where: { asset: visibleAsset } } } },
        assets: expect.objectContaining({ where: { asset: visibleAsset } }),
      }),
    }));
  });
});

describe('DeviceService.remove', () => {
  it('moves every active linked asset to Trash before removing the owned device', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const linkedFindMany = vi.fn().mockResolvedValue([
      { assetId: 'asset-1' },
      { assetId: 'asset-2' },
    ]);
    const moveToTrash = vi
      .fn()
      .mockResolvedValue({ trashed: 2, assetIds: ['asset-1', 'asset-2'] });
    const service = new DeviceService(
      {
        device: { findFirst: vi.fn().mockResolvedValue({ id: 'device-id' }), deleteMany },
        deviceAsset: { findMany: linkedFindMany },
      } as never,
      { moveToTrash } as never,
    );

    await expect(service.remove('owner-id', 'device-id')).resolves.toEqual({
      deleted: true,
      trashedAssets: 2,
    });
    expect(moveToTrash).toHaveBeenCalledWith('owner-id', ['asset-1', 'asset-2']);
    expect(linkedFindMany).toHaveBeenCalledWith({
      where: {
        deviceId: 'device-id',
        asset: { ownerId: 'owner-id', deletedAt: null, isDeviceOnly: true },
      },
      select: { assetId: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'device-id', ownerId: 'owner-id' },
    });
  });

  it('does not reveal or remove a device owned by somebody else', async () => {
    const deleteMany = vi.fn();
    const moveToTrash = vi.fn();
    const service = new DeviceService(
      { device: { findFirst: vi.fn().mockResolvedValue(null), deleteMany } } as never,
      { moveToTrash } as never,
    );

    await expect(service.remove('owner-id', 'other-device')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(moveToTrash).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe('DeviceService.backedUpAssetIds', () => {
  it('keeps promoted media marked as backed up through its device association', async () => {
    const findMany = vi.fn().mockResolvedValue([{ deviceAssetId: 'ios-photo-id' }]);
    const service = new DeviceService(
      {
        device: { findUnique: vi.fn().mockResolvedValue({ id: 'device-id' }) },
        deviceAsset: { findMany },
      } as never,
      {} as never,
    );

    await expect(service.backedUpAssetIds('owner-id', 'client-id')).resolves.toEqual([
      'ios-photo-id',
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { deviceId: 'device-id', asset: { deletedAt: null } },
      select: { deviceAssetId: true },
    });
  });
});
