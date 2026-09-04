import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { getItem, removeItem, setItem } from './storage';
import { ALL_STORAGE_KEYS } from './storageKeys';

const INSTALL_ID_KEY = 'imadeo.install.id';
const INSTALL_FILE = `${FileSystem.documentDirectory ?? ''}.imadeo-install`;

let checking: Promise<void> | null = null;

function freshId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Clears Keychain values left behind when iOS removes the app container.
 *
 * The secure install id is introduced alongside this check. When neither
 * marker exists, this may be an existing installation upgrading from an older
 * build, so its data is kept and both markers are created. On later reinstalls
 * the Keychain marker remains while the app-container file is gone, which is
 * the unambiguous signal to start clean.
 */
export async function ensureCurrentInstallation(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (checking) return checking;

  checking = (async () => {
    const marker = await FileSystem.getInfoAsync(INSTALL_FILE).catch(() => null);
    if (marker?.exists) return;

    const retainedInstallId = await getItem(INSTALL_ID_KEY);
    if (retainedInstallId) {
      await Promise.all(ALL_STORAGE_KEYS.map((key) => removeItem(key)));
      await removeItem(INSTALL_ID_KEY);
    }

    const installId = freshId();
    await setItem(INSTALL_ID_KEY, installId);
    await FileSystem.writeAsStringAsync(INSTALL_FILE, installId);
  })().finally(() => {
    checking = null;
  });

  return checking;
}
