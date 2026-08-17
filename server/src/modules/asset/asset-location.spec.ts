import { describe, expect, it } from 'vitest';
import { assetLocations } from './asset-location';

describe('assetLocations', () => {
  it('returns every in-app path for an asset', () => {
    expect(
      assetLocations(
        {
          folder: { id: 'child', name: 'Trips' },
          albums: [{ album: { name: 'Summer', folderId: 'root' } }],
          deviceAssets: [{ device: { name: 'Eran’s iPhone' } }],
          isDeviceOnly: false,
          visibility: 'TIMELINE',
        },
        [
          { id: 'root', name: 'Family', parentId: null },
          { id: 'child', name: 'Trips', parentId: 'root' },
        ],
      ),
    ).toEqual([
      { kind: 'folder', label: 'Browse / Family / Trips' },
      { kind: 'album', label: 'Browse / Family / Summer' },
      { kind: 'device', label: 'Devices / Eran’s iPhone Library' },
    ]);
  });

  it('identifies an unfiled timeline asset', () => {
    expect(
      assetLocations(
        {
          folder: null,
          albums: [],
          deviceAssets: [],
          isDeviceOnly: false,
          visibility: 'TIMELINE',
        },
        [],
      ),
    ).toEqual([{ kind: 'photos', label: 'Photos / Unfiled' }]);
  });
});
