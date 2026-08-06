import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Keychain/Keystore on a device, localStorage in a browser.
 *
 * expo-secure-store has no web implementation — calling it there throws
 * "getValueWithKeyAsync is not a function". Web only exists here so the app can
 * be previewed during development; a real install is always native, and that is
 * the path that gets the secure storage.
 */
const web = Platform.OS === 'web';

export async function setItem(key: string, value: string) {
  if (web) { localStorage.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}

export async function getItem(key: string): Promise<string | null> {
  if (web) return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function removeItem(key: string) {
  if (web) { localStorage.removeItem(key); return; }
  await SecureStore.deleteItemAsync(key);
}
