import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { Asset } from './api';
import { ensureFreshToken, sessionGeneration } from './auth';

/** Export authenticated originals, then remove the private temporary copy. */
export async function exportAsset(serverUrl: string, asset: Asset, action: 'share' | 'download') {
  const generation = sessionGeneration();
  if (action === 'share' && !await Sharing.isAvailableAsync()) {
    throw new Error('Sharing is not available on this device.');
  }
  if (action === 'download' && Platform.OS !== 'ios') {
    const permission = await MediaLibrary.requestPermissionsAsync(true, [asset.type === 'VIDEO' ? 'video' : 'photo']);
    if (!permission.granted) throw new Error('Allow photo access in Settings to save this file.');
  }
  const token = await ensureFreshToken(serverUrl);
  if (!FileSystem.cacheDirectory) throw new Error('Temporary storage is unavailable.');
  const directory = `${FileSystem.cacheDirectory}export-${Date.now()}-${Math.random().toString(36).slice(2)}/`;
  const filename = asset.originalFileName?.replace(/[/\\\x00-\x1f]/g, '_');
  if (!filename || !/\.[a-z0-9]+$/i.test(filename)) {
    throw new Error('The original filename is missing its file extension.');
  }
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  try {
    const result = await FileSystem.downloadAsync(
      `${serverUrl}/api/assets/${encodeURIComponent(asset.id)}/download`,
      `${directory}${encodeURIComponent(filename)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (result.status !== 200) throw new Error('The original could not be downloaded. Please try again.');
    if (generation !== sessionGeneration()) throw new Error('Your session changed. Please try again.');
    if (action === 'share') await Sharing.shareAsync(result.uri);
    else await MediaLibrary.saveToLibraryAsync(result.uri);
  } finally {
    await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => undefined);
  }
}
