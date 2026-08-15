import { describe, expect, it, vi } from 'vitest';
import { AssetType, AssetVisibility } from '../../db';
import { UserService } from './user.service';

describe('UserService statistics', () => {
  it('counts only main-library media but includes every active file in storage usage', async () => {
    const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const aggregate = vi.fn().mockResolvedValue({ _sum: { fileSizeInByte: 123n } });
    const service = new UserService(
      { asset: { count, aggregate } } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.statistics('owner-id')).resolves.toEqual({
      images: 0,
      videos: 0,
      total: 0,
      usageInBytes: 123n,
    });
    const scope = {
      ownerId: 'owner-id',
      deletedAt: null,
      isDeviceOnly: false,
      visibility: { in: [AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE] },
    };
    expect(count).toHaveBeenNthCalledWith(1, { where: { ...scope, type: AssetType.IMAGE } });
    expect(count).toHaveBeenNthCalledWith(2, { where: { ...scope, type: AssetType.VIDEO } });
    expect(aggregate).toHaveBeenCalledWith({
      where: { ownerId: 'owner-id', deletedAt: null },
      _sum: { fileSizeInByte: true },
    });
  });
});
