import { describe, expect, it } from 'vitest';
import { AssetVisibility } from '../db';
import {
  MAIN_LIBRARY_ASSET_SQL,
  mainLibraryAssetWhere,
} from './asset-scope';

describe('main library asset scope', () => {
  it('excludes deleted, hidden, locked, and device-only media', () => {
    expect(mainLibraryAssetWhere('owner-id')).toEqual({
      ownerId: 'owner-id',
      deletedAt: null,
      isDeviceOnly: false,
      visibility: {
        in: [AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE],
      },
    });
  });

  it('keeps raw SQL discovery queries on the same scope', () => {
    const sql = MAIN_LIBRARY_ASSET_SQL.strings.join(' ');
    expect(sql).toContain('a."deletedAt" IS NULL');
    expect(sql).toContain('a."isDeviceOnly" = false');
    expect(sql).toContain("a.visibility IN ('TIMELINE', 'ARCHIVE')");
  });
});
