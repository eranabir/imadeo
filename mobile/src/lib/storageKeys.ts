/**
 * Every value Imadeo keeps in Keychain/Keystore.
 *
 * Keep these in one registry so a fresh installation can remove credentials
 * retained by iOS after the previous installation was deleted.
 */
export const STORAGE_KEYS = {
  access: 'imadeo.access',
  refresh: 'imadeo.refresh',
  legacyServer: 'imadeo.server',
  servers: 'imadeo.servers.v2',
  activeServer: 'imadeo.server.active',
  legacyUploaded: 'imadeo.uploaded',
  deviceId: 'imadeo.deviceId',
  autoplayVideos: 'imadeo.autoplayVideos',
  appearance: 'imadeo.appearance',
  cellular: 'imadeo.cellular',
  mediaViewMode: 'imadeo.mediaViewMode',
  autoBackupEnabled: 'imadeo.autobackup.enabled',
  autoBackupLastRun: 'imadeo.autobackup.lastRun',
} as const;

export const ALL_STORAGE_KEYS = Object.values(STORAGE_KEYS);
