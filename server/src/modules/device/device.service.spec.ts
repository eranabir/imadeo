import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DeviceService } from './device.service';

describe('DeviceService.remove', () => {
  it('moves every active linked asset to Trash before removing the owned device', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const moveToTrash = vi
      .fn()
      .mockResolvedValue({ trashed: 2, assetIds: ['asset-1', 'asset-2'] });
    const service = new DeviceService(
      {
        device: { findFirst: vi.fn().mockResolvedValue({ id: 'device-id' }), deleteMany },
        deviceAsset: {
          findMany: vi.fn().mockResolvedValue([
            { assetId: 'asset-1' },
            { assetId: 'asset-2' },
          ]),
        },
      } as never,
      { moveToTrash } as never,
    );

    await expect(service.remove('owner-id', 'device-id')).resolves.toEqual({
      deleted: true,
      trashedAssets: 2,
    });
    expect(moveToTrash).toHaveBeenCalledWith('owner-id', ['asset-1', 'asset-2']);
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
