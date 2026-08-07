import * as MediaLibrary from 'expo-media-library';
import { storedToken } from './auth';
import { getItem, setItem } from './storage';

const DONE_KEY = 'imadeo.uploaded';
const DEVICE_KEY = 'imadeo.deviceId';

/**
 * Which device assets have already reached the server.
 *
 * Held locally so a backup run does not have to ask the server about every
 * photo on the phone before it can start. The server still deduplicates by
 * sha1, so this list being wrong costs bandwidth, never correctness — losing it
 * re-uploads, it does not duplicate.
 */
async function loadDone(): Promise<Set<string>> {
  const raw = await getItem(DONE_KEY);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function saveDone(done: Set<string>) {
  await setItem(DONE_KEY, JSON.stringify([...done]));
}

/**
 * Which of this phone's assets are already on the server.
 *
 * The grid marks these, so "is this one safe yet" is answerable per photo
 * rather than only as a count in the header.
 */
export async function uploadedIds(): Promise<Set<string>> {
  return loadDone();
}

/** Identifies this phone to the server, so several devices stay distinguishable. */
async function deviceId(): Promise<string> {
  const existing = await getItem(DEVICE_KEY);
  if (existing) return existing;
  const fresh = `mobile-${Math.random().toString(36).slice(2, 10)}`;
  await setItem(DEVICE_KEY, fresh);
  return fresh;
}

export interface Progress {
  done: number;
  total: number;
  failed: number;
}

/**
 * Uploads everything the phone has that this device has not sent before.
 *
 * Sequential rather than parallel: a phone on home Wi-Fi uploading full-size
 * video will saturate the link either way, and one at a time keeps the progress
 * count honest and the failure of one item from taking others with it.
 */
export async function runBackup(
  baseUrl: string,
  onProgress: (p: Progress) => void,
  shouldStop: () => boolean,
  /**
   * Restricts the run to these device asset ids. Omitted, everything this phone
   * has not sent goes. Anything already uploaded is skipped either way, so
   * picking a photo that is already safe costs nothing.
   */
  only?: string[],
): Promise<Progress> {
  const token = await storedToken();
  if (!token) throw new Error('Not signed in.');

  const id = await deviceId();
  const done = await loadDone();

  const page = await MediaLibrary.getAssetsAsync({
    first: 10000,
    mediaType: ['photo', 'video'],
    sortBy: [MediaLibrary.SortBy.creationTime],
  });

  const wanted = only ? new Set(only) : null;
  const pending = page.assets.filter(
    (asset) => !done.has(asset.id) && (wanted === null || wanted.has(asset.id)),
  );
  const progress: Progress = { done: 0, total: pending.length, failed: 0 };
  onProgress({ ...progress });

  for (const asset of pending) {
    if (shouldStop()) break;

    try {
      // On iOS `asset.uri` is a ph:// reference into the Photos database.
      // Networking cannot read those — handing one to fetch throws "No
      // suitable URL request handler found for ph://" and takes down the
      // screen. Only a real file:// path from getAssetInfoAsync will do.
      //
      // shouldDownloadFromNetwork pulls the original back for photos that
      // iCloud has offloaded; without it those resolve to nothing on a phone
      // using Optimise Storage, which is most of them.
      const info = await MediaLibrary.getAssetInfoAsync(asset, {
        shouldDownloadFromNetwork: true,
      });
      const uri = info.localUri;
      if (!uri || uri.startsWith('ph://')) {
        throw new Error(`No local file for ${asset.filename}`);
      }

      const form = new FormData();
      form.append('assetData', {
        uri,
        name: asset.filename,
        type: asset.mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
      } as unknown as Blob);
      form.append('deviceAssetId', asset.id);
      form.append('deviceId', id);
      form.append('fileCreatedAt', new Date(asset.creationTime).toISOString());
      form.append('fileModifiedAt', new Date(asset.modificationTime).toISOString());

      const response = await fetch(`${baseUrl}/api/assets/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (!response.ok) throw new Error(String(response.status));

      done.add(asset.id);
      progress.done += 1;
      // Written as we go, so closing the app mid-run does not repeat everything
      // already sent.
      if (progress.done % 10 === 0) await saveDone(done);
    } catch {
      progress.failed += 1;
    }

    onProgress({ ...progress });
  }

  await saveDone(done);
  return progress;
}

/** How many device items have not been sent from this phone yet. */
export async function pendingCount(): Promise<number> {
  const done = await loadDone();
  const page = await MediaLibrary.getAssetsAsync({ first: 10000, mediaType: ['photo', 'video'] });
  return page.assets.filter((a) => !done.has(a.id)).length;
}
