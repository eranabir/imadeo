import { describe, expect, it, vi } from 'vitest';
import { AlbumService } from './album.service';

describe('AlbumService.getAssetIds', () => {
  it('returns the complete album selection without the grid page limit', async () => {
    const rows = Array.from({ length: 359 }, (_, index) => ({ assetId: `asset-${index}` }));
    const findMany = vi.fn().mockResolvedValue(rows);
    const service = new AlbumService(
      { albumAsset: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'getAccess').mockResolvedValue('owner');

    const result = await service.getAssetIds({ user: { id: 'owner-id' } } as never, 'album-id');

    expect(result.ids).toHaveLength(359);
    expect(findMany).toHaveBeenCalledWith({
      where: { albumId: 'album-id', asset: { deletedAt: null } },
      select: { assetId: true },
      orderBy: [{ asset: { localDateTime: 'desc' } }, { assetId: 'desc' }],
    });
  });
});
