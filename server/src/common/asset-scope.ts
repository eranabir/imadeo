import { AssetVisibility, Prisma } from '../db';

/**
 * Media that belongs to the user's browsable library.
 *
 * Device backups stay inside Devices until they are explicitly promoted, and
 * HIDDEN is reserved for companion files such as the motion half of Live
 * Photos. Every global discovery surface must use this same scope.
 */
export const MAIN_LIBRARY_VISIBILITIES = [
  AssetVisibility.TIMELINE,
  AssetVisibility.ARCHIVE,
];

export const mainLibraryAssetWhere = (ownerId?: string): Prisma.AssetWhereInput => ({
  ...(ownerId ? { ownerId } : {}),
  deletedAt: null,
  isDeviceOnly: false,
  visibility: { in: [...MAIN_LIBRARY_VISIBILITIES] },
});

/** The SQL equivalent of `mainLibraryAssetWhere`, for queries using alias `a`. */
export const MAIN_LIBRARY_ASSET_SQL = Prisma.sql`
  AND a."deletedAt" IS NULL
  AND a."isDeviceOnly" = false
  AND a.visibility IN ('TIMELINE', 'ARCHIVE')
`;
