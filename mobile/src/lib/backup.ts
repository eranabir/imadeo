import * as FileSystem from 'expo-file-system/legacy';
import * as Device from 'expo-device';
/*
 * The legacy entry, deliberately.
 *
 * SDK 57 rewrote this module: an `Asset` is now an object of getters
 * (`getCreationTime`, `getMediaType`) rather than plain fields, and `SortBy`
 * has gone from the main export. That is a migration of its own — the backup
 * engine and the device grid both read these fields all over — and it does not
 * belong in the middle of a navigation migration. `expo-file-system` is
 * imported the same way here for the same reason.
 */
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import { libraryChanged } from './api';
import { storedToken } from './auth';
import { cellularAllowed } from './preferences';
import { getItem, removeItem, setItem } from './storage';

const DONE_KEY = 'imadeo.uploaded';
const DEVICE_KEY = 'imadeo.deviceId';

/**
 * The upload log lives in a file, not the keychain.
 *
 * It used to go through `SecureStore`, which is the platform keychain: iOS
 * warns above 2KB per value and neither platform intends it for bulk data. A
 * phone with ten thousand photos produces a JSON array of ten thousand UUIDs,
 * and it is not a secret in any case — it is bookkeeping about which of your
 * own photos you have already sent to your own server.
 */
const DONE_FILE = `${FileSystem.documentDirectory ?? ''}uploaded.json`;

/**
 * Which device assets have already reached the server.
 *
 * Held locally so a backup run does not have to ask the server about every
 * photo on the phone before it can start. The server still deduplicates by
 * sha1, so this list being wrong costs bandwidth, never correctness — losing it
 * re-uploads, it does not duplicate.
 */
async function loadDone(): Promise<Set<string>> {
  const parse = (raw: string) => {
    try {
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return null;
    }
  };

  try {
    const info = await FileSystem.getInfoAsync(DONE_FILE);
    if (info.exists) {
      const parsed = parse(await FileSystem.readAsStringAsync(DONE_FILE));
      if (parsed) return parsed;
    }
  } catch {
    // Unreadable file: fall through and treat it as an empty log.
  }

  // Anything written by an older build is still in the keychain. Carry it over
  // once so an upgrade does not re-send the whole camera roll, then let go of it.
  const legacy = await getItem(DONE_KEY);
  if (legacy) {
    const parsed = parse(legacy) ?? new Set<string>();
    await saveDone(parsed);
    await removeItem(DONE_KEY);
    return parsed;
  }

  return new Set();
}

async function saveDone(done: Set<string>) {
  await FileSystem.writeAsStringAsync(DONE_FILE, JSON.stringify([...done]));
}

/**
 * Which of this phone's assets are already on the server.
 *
 * The grid marks these, so "is this one safe yet" is answerable per photo
 * rather than only as a count in the header.
 */
export async function uploadedIds(baseUrl?: string): Promise<Set<string>> {
  const done = await loadDone();
  if (!baseUrl) return done;
  return (await syncDone(baseUrl, done)) ?? done;
}

/**
 * Reconciles the local upload log against what the server actually holds.
 *
 * The log alone is a per-install file: reinstall the app, or run a second build
 * beside the first, and it starts empty on a phone whose pictures are all
 * already backed up — so everything is offered for upload again. The server
 * knows better, and the photo ids it stores come from the OS rather than from
 * any one install, so they still line up.
 *
 * Merged rather than replaced: the local log may legitimately be ahead, holding
 * an upload that finished moments ago. A failure here is silent — the log is an
 * optimisation, and a backup run that cannot reach the server has bigger
 * problems to report than this.
 */
async function syncDone(baseUrl: string, done: Set<string>): Promise<Set<string> | null> {
  try {
    const token = await storedToken();
    if (!token) return null;
    const id = await deviceId();

    const response = await fetch(
      `${baseUrl}/api/assets/backed-up?deviceId=${encodeURIComponent(id)}`,
      {
      headers: { Authorization: `Bearer ${token}`, 'x-imadeo-client': 'native' },
      },
    );
    if (!response.ok) return null;

    const ids = (await response.json()) as string[];
    const before = done.size;
    for (const id of ids) done.add(id);
    if (done.size !== before) await saveDone(done);

    return done;
  } catch {
    return null;
  }
}

/** Identifies this phone to the server, so several devices stay distinguishable. */
async function deviceId(): Promise<string> {
  const existing = await getItem(DEVICE_KEY);
  if (existing) return existing;
  const fresh = `mobile-${Math.random().toString(36).slice(2, 10)}`;
  await setItem(DEVICE_KEY, fresh);
  return fresh;
}

/** Name shown for this library in Devices. */
function deviceName(): string {
  const detected = Device.deviceName?.trim();
  if (detected) return detected;
  if (Platform.OS === 'ios') return 'iPhone';
  if (Platform.OS === 'android') return 'Android device';
  return 'Mobile device';
}

/**
 * Every format the server will take, by extension.
 *
 * The uploader used to label everything `video/mp4` or `image/jpeg` whatever it
 * actually was, so a HEIC arrived claiming to be a JPEG and a MOV claiming to
 * be an MP4. The server survives that — it reads the extension first — but the
 * wrong type is then stored and sent back on download, and anything that trusts
 * the header rather than the name gets a file that is not what it says.
 */
const MIME: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.jxl': 'image/jxl',
  // Raw
  '.dng': 'image/x-adobe-dng', '.cr2': 'image/x-canon-cr2', '.cr3': 'image/x-canon-cr3',
  '.nef': 'image/x-nikon-nef', '.arw': 'image/x-sony-arw', '.raf': 'image/x-fuji-raf',
  '.orf': 'image/x-olympus-orf', '.rw2': 'image/x-panasonic-rw2', '.pef': 'image/x-pentax-pef',
  '.srw': 'image/x-samsung-srw', '.raw': 'image/x-dcraw',
  // Video
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.m4v': 'video/x-m4v',
  '.3gp': 'video/3gpp', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
  '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv', '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t', '.insv': 'video/mp4',
};

/** The real type of a file, from its name. Falls back to what the kind implies. */
export function mimeOf(filename: string, kind: MediaLibrary.MediaTypeValue): string {
  const dot = filename.lastIndexOf('.');
  const extension = dot === -1 ? '' : filename.slice(dot).toLowerCase();
  return MIME[extension] ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg');
}

/** Which of the two settings an asset answers to. */
function kindOf(asset: MediaLibrary.Asset): 'photos' | 'videos' {
  return asset.mediaType === MediaLibrary.MediaType.video ? 'videos' : 'photos';
}

/**
 * What the connection underfoot is allowed to send.
 *
 * Only `CELLULAR` counts as metered. Wi-Fi, ethernet and a VPN riding on top of
 * one are not, and neither is a type the platform cannot name — treating
 * `UNKNOWN` as mobile data would stop backups on connections that cost nothing,
 * which is a worse failure than the one this is guarding against.
 *
 * Offline holds everything: there is no point starting a run that cannot reach
 * the server, and the count tells the screen why nothing moved.
 */
async function allowedNow(): Promise<(kind: 'photos' | 'videos') => boolean> {
  let state: Network.NetworkState | null = null;
  try {
    state = await Network.getNetworkStateAsync();
  } catch {
    // No answer from the platform. Assume the connection is free rather than
    // silently refusing to back anything up.
    return () => true;
  }

  if (state.isConnected === false) return () => false;
  if (state.type !== Network.NetworkStateType.CELLULAR) return () => true;

  const cellular = cellularAllowed();
  return (kind) => cellular[kind];
}

/** One item's outcome, as far as the run has got. */
export interface Attempt {
  id: string;
  filename: string;
  /** Why it failed. Absent while waiting, sending, or once it has landed. */
  reason?: string;
}

export interface Progress {
  done: number;
  total: number;
  failed: number;
  /**
   * Held back because this connection is not allowed to carry them.
   *
   * Counted rather than queued: they are not waiting their turn, they are
   * waiting for a different network, and a progress bar that includes them
   * would never finish. The screen says so instead.
   */
  held: number;
  /**
   * The queue, in the order it will be sent, and where the run has reached.
   *
   * A count alone answers "how much is left" and nothing else — not which
   * photo is going up, not which ones did not make it, not why. This is what
   * the progress screen reads.
   */
  queue: Attempt[];
  /** Index into `queue` of the item being sent right now, or -1 between items. */
  at: number;
  /** Ids that have landed on the server during this run. */
  sent: string[];
  /** The ones that did not, each with the reason it gave. */
  failures: Attempt[];
}

/**
 * Uploads everything the phone has that this device has not sent before.
 *
 * Sequential rather than parallel: a phone on home Wi-Fi uploading full-size
 * video will saturate the link either way, and one at a time keeps the progress
 * count honest and the failure of one item from taking others with it.
 */
/**
 * Whether a run is already in flight, anywhere in the app.
 *
 * There are three things that can start one now — the button, the app coming to
 * the front, and the system waking the background task — and two of them can
 * fire within a second of each other when a phone is unlocked. Two runs would
 * read the same pending list and send everything twice; the server would refuse
 * the duplicates, but the phone would still have uploaded them.
 *
 * Module-level rather than React state because the background task runs with no
 * component mounted at all.
 */
let inFlight = false;

/** Whether something is uploading right now. */
export const backupInFlight = () => inFlight;

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
  if (inFlight) throw new Error('A backup is already running.');
  inFlight = true;
  try {
    return await send(baseUrl, onProgress, shouldStop, only);
  } finally {
    inFlight = false;
  }
}

async function send(
  baseUrl: string,
  onProgress: (p: Progress) => void,
  shouldStop: () => boolean,
  only?: string[],
): Promise<Progress> {
  const token = await storedToken();
  if (!token) throw new Error('Not signed in.');

  const id = await deviceId();
  // Reconciled first, so a run started on a fresh install does not re-send the
  // whole camera roll before it works out that the server already has it.
  const done = await uploadedIds(baseUrl);

  const page = await MediaLibrary.getAssetsAsync({
    first: 10000,
    mediaType: ['photo', 'video'],
    sortBy: [MediaLibrary.SortBy.creationTime],
  });

  const wanted = only ? new Set(only) : null;
  const unsent = page.assets.filter(
    (asset) => !done.has(asset.id) && (wanted === null || wanted.has(asset.id)),
  );

  /*
   * What this connection is allowed to carry.
   *
   * Read once, at the start. A run that re-checked between every item would
   * stop halfway through a video the moment a phone left the house, and the
   * partial upload would be wasted either way — the next run picks the rest up.
   */
  const allowed = await allowedNow();
  const pending = unsent.filter((asset) => allowed(kindOf(asset)));

  const progress: Progress = {
    done: 0,
    total: pending.length,
    failed: 0,
    held: unsent.length - pending.length,
    queue: pending.map((asset) => ({ id: asset.id, filename: asset.filename })),
    at: -1,
    sent: [],
    failures: [],
  };
  onProgress({ ...progress });

  for (const [index, asset] of pending.entries()) {
    if (shouldStop()) break;

    // Published before the upload starts, so the screen can say which photo is
    // in flight rather than only how many have been.
    progress.at = index;
    onProgress({ ...progress });

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

      /**
       * Streamed from disk rather than assembled in memory.
       *
       * `fetch` with a `FormData` holding a file URI reads the whole file into
       * the JS heap before sending a byte of it. One 400MB video is enough to
       * kill the app outright, which is what a backup of eighty items was doing
       * partway through — and doing again on the next attempt, because it
       * stopped at the same file every time.
       *
       * `uploadAsync` hands the path to the platform's own HTTP stack, which
       * reads it off disk as it goes. Memory then does not depend on how big
       * the video is.
       */
      const response = await FileSystem.uploadAsync(`${baseUrl}/api/assets/upload`, uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'assetData',
        mimeType: mimeOf(asset.filename, asset.mediaType),
        headers: { Authorization: `Bearer ${token}`, 'x-imadeo-client': 'native' },
        parameters: {
          deviceAssetId: asset.id,
          deviceId: id,
          deviceName: deviceName(),
          devicePlatform: Platform.OS,
          fileCreatedAt: new Date(asset.creationTime).toISOString(),
          fileModifiedAt: new Date(asset.modificationTime).toISOString(),
        },
      });

      if (response.status < 200 || response.status >= 300) {
        // The status alone ends up in front of someone as the reason a photo
        // is missing, and "413" is not a reason. The server's own message is
        // used when it sends one — `uploadAsync` hands back the body as text,
        // not as something with `.json()` on it.
        let said: string | undefined;
        try {
          const body = JSON.parse(response.body) as { message?: string | string[] };
          said = Array.isArray(body.message) ? body.message[0] : body.message;
        } catch {
          // Not JSON — a proxy's HTML error page, most likely.
        }
        throw new Error(
          said ??
            (response.status === 413
              ? 'Too large for this server'
              : response.status === 401
                ? 'Signed out — sign in again'
                : `Server answered ${response.status}`),
        );
      }

      done.add(asset.id);
      progress.done += 1;
      progress.sent.push(asset.id);
      /**
       * Recorded after every single upload, not every tenth.
       *
       * Batching assumed the run ends by returning. It does not have to — the
       * app can be killed by the system mid-backup, and everything since the
       * last multiple of ten is then sent again on the next attempt. A local
       * file write costs nothing next to having just uploaded a video.
       */
      await saveDone(done);
    } catch (e) {
      progress.failed += 1;
      /**
       * Kept, rather than only counted.
       *
       * "3 could not be sent" is not something anyone can act on. A name and
       * the reason is: a video too large for the server's limit and a photo
       * iCloud never handed over are different problems with different fixes.
       */
      progress.failures.push({
        id: asset.id,
        filename: asset.filename,
        reason: e instanceof Error ? e.message : 'Upload failed',
      });
    }

    onProgress({ ...progress });
  }

  progress.at = -1;
  await saveDone(done);

  // Only when something actually landed. A run that found nothing to send left
  // the library exactly as it was, and waking every screen to refetch the same
  // answer is the sort of thing that makes a photo app feel busy for nothing.
  if (progress.sent.length > 0) libraryChanged();

  onProgress({ ...progress });
  return progress;
}

/** How many device items have not been sent from this phone yet. */
export async function pendingCount(baseUrl?: string): Promise<number> {
  const done = await uploadedIds(baseUrl);
  const page = await MediaLibrary.getAssetsAsync({ first: 10000, mediaType: ['photo', 'video'] });
  return page.assets.filter((a) => !done.has(a.id)).length;
}
