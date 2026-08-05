import { Permission } from '../db';

/** Everything downstream code needs to know about who is making a request. */
export interface AuthDto {
  user: {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
    quotaSizeInBytes: bigint | null;
    quotaUsageInBytes: bigint;
  };
  session?: {
    id: string;
    /** Null when the vault has never been unlocked on this device. */
    vaultUnlockedUntil: Date | null;
  };
  apiKey?: {
    id: string;
    permissions: Permission[];
  };
  /** Present when the request authenticated with a public share key instead. */
  sharedLink?: {
    id: string;
    albumId: string | null;
    allowUpload: boolean;
    allowDownload: boolean;
    showExif: boolean;
    assetIds: string[];
  };
}

export const AUTH_COOKIE = {
  ACCESS: 'imadeo_access_token',
  REFRESH: 'imadeo_refresh_token',
  SHARED_LINK: 'imadeo_shared_link_token',
} as const;

export const AUTH_HEADER = {
  API_KEY: 'x-api-key',
  SHARED_LINK: 'x-imadeo-share-key',
} as const;
