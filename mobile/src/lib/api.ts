import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { expireSession, refreshToken, SessionRefreshError, storedToken } from './auth';

/** The asset fields every grid in the app needs, and no more. */
export interface Asset {
  id: string;
  /** The account that owns the original, even when it is shared with us. */
  ownerId: string;
  type: 'IMAGE' | 'VIDEO';
  /** A clock string such as "00:00:12.500", not a number of seconds. */
  duration?: string | null;
  originalFileName?: string;
  localDateTime?: string;
  isFavorite?: boolean;
  rotation?: 0 | 90 | 180 | 270;
}

export interface Paged<T> {
  items: T[];
  pagination?: { page: number; size: number; total: number; pages?: number };
}

/** Some container endpoints keep their media under `assets` beside metadata. */
interface AssetPage<T> {
  assets: T[];
  pagination?: Paged<T>['pagination'];
}

type PageItemsKey = 'items' | 'assets';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string;
  shared?: boolean;
  assetCount: number;
  albumCount: number;
  childCount: number;
  color: string | null;
  icon: string | null;
}

export interface Album {
  id: string;
  owner?: { id: string; name: string | null };
  name: string;
  /** The folder it lives in; null means loose, at the root of the tree. */
  folderId?: string | null;
  assetCount: number;
  coverAssetId: string | null;
  coverAssetIds: string[];
  shared?: boolean;
  description?: string | null;
}

export interface Device {
  id: string;
  name: string;
  libraryName: string;
  platform: string;
  assetCount: number;
  coverAssetId: string | null;
  lastSeenAt: string;
}

export interface Breadcrumb {
  id: string;
  name: string;
}

export interface FolderContents {
  folder: { id: string; name: string } | null;
  breadcrumbs: Breadcrumb[];
  folders: Folder[];
  albums: Album[];
  assets: Asset[];
  pagination: { page: number; size: number; total: number; pages: number };
}

export interface Subject {
  id: string;
  name: string;
  kind: 'PERSON' | 'PET';
  species: string | null;
  faceCount: number;
  isFavorite: boolean;
  isHidden: boolean;
  hasName?: boolean;
  thumbnailUpdatedAt?: string;
}

/**
 * Whether the last request got through to the server at all.
 *
 * A self-hosted server is off far more often than a commercial one — it is a
 * machine at home that reboots, drops off the wifi, or is simply not on the
 * same network as the phone right now. Every screen showing its own small red
 * line said "this list failed" when the truth was "nothing can reach the
 * server", so it is tracked once, here, where every request already passes.
 */
export type ServerReachability = 'checking' | 'reachable' | 'unreachable';

let reachability: ServerReachability = 'checking';
const watchers = new Set<(state: ServerReachability) => void>();

function setReachability(next: ServerReachability) {
  if (next === reachability) return;
  reachability = next;
  for (const watcher of watchers) watcher(next);
}

/** Hides authenticated routes while a newly selected server is being checked. */
export function beginServerCheck() {
  setReachability('checking');
}

/** Re-renders when the selected server is checked, reachable or unreachable. */
export function useServerReachability() {
  const [state, setState] = useState(reachability);
  useEffect(() => {
    watchers.add(setState);
    // The flag may have changed between the first render and this effect.
    setState(reachability);
    return () => {
      watchers.delete(setState);
    };
  }, []);
  return state;
}

/** Asks the server whether it is there, without caring what it says. */
export async function ping(serverUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    await fetch(`${serverUrl}/api`, { signal: controller.signal });
    setReachability('reachable');
    return true;
  } catch {
    setReachability('unreachable');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One trip to the server, with the session attached and the error unwrapped.
 *
 * Nest sends failures as `{ message }` — sometimes a string, sometimes an array
 * of them from the validation pipe. Surfacing that instead of the status code is
 * the difference between "Server answered 400" and being told which field was
 * wrong.
 */
export async function request<T>(
  serverUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await storedToken();

  const send = async (accessToken: string | null) => {
    const controller = new AbortController();
    const callerSignal = init.signal;
    const cancel = () => controller.abort();
    const timer = setTimeout(cancel, 12_000);
    if (callerSignal?.aborted) cancel();
    else callerSignal?.addEventListener('abort', cancel, { once: true });

    try {
      return await fetch(`${serverUrl}/api${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          'x-imadeo-client': 'native',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...init.headers,
        },
      });
    } catch {
      // Only a thrown fetch means unreachable. A 500 is the server answering.
      setReachability('unreachable');
      throw new Error('Could not reach your server. Check your connection.');
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', cancel);
    }
  };

  let response = await send(token);

  // Native sessions use short-lived access tokens and rotating refresh tokens.
  // Retry the original request once, after one shared refresh, so simultaneous
  // tab loads cannot race each other and invalidate the session.
  if (response.status === 401 && token) {
    try {
      response = await send(await refreshToken(serverUrl));
    } catch (cause) {
      setReachability(
        cause instanceof SessionRefreshError && cause.unreachable ? 'unreachable' : 'reachable',
      );
      throw cause;
    }
  }

  // A missing token, or a token the server still rejects after refreshing, is
  // one global signed-out state. Never leave a single tab to render a local
  // "Authentication required" error over data from the old session.
  if (response.status === 401) {
    setReachability('reachable');
    await expireSession();
    throw new SessionRefreshError('Your session has expired. Please sign in again.', false);
  }

  setReachability('reachable');

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new Error(message ?? `The server answered ${response.status}.`);
  }

  // 204s carry nothing, and asking an empty body for JSON throws.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * A GET that reloads when its path changes, with the token already in hand.
 *
 * The token is returned alongside the data because thumbnails cannot use this
 * function at all: `expo-image` fetches them itself, so it needs the header
 * value rather than a promise for it.
 */
/**
 * A count of how many times this app has changed the library.
 *
 * Every screen holding server data has the same problem: a backup finishes, or
 * a photo is moved or trashed, and every other screen is still showing what it
 * fetched when it was opened. Browse kept saying "209 on your server" after six
 * more had landed, and the photos themselves were simply absent until the app
 * was restarted.
 *
 * One number, bumped by whatever did the changing, watched by every `useResource`
 * — rather than each screen guessing when someone else might have altered
 * something. Screens that ask on a timer already handle this; the rest could not.
 */
let revision = 0;
const revisionListeners = new Set<(next: number) => void>();

/** Says the library is not what it was, so anything showing it asks again. */
export function libraryChanged() {
  revision += 1;
  for (const listener of revisionListeners) listener(revision);
}

function useRevision(): number {
  const [value, setValue] = useState(revision);
  useEffect(() => {
    revisionListeners.add(setValue);
    return () => {
      revisionListeners.delete(setValue);
    };
  }, []);
  return value;
}

/** Revalidates a mounted screen whenever navigation brings it back into view. */
function useReloadOnFocus(reload: (silent?: boolean) => Promise<void>) {
  const reloadRef = useRef(reload);
  const hasFocused = useRef(false);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      // The regular resource effect owns the initial request. Subsequent focus
      // events cover changes made by the web app or another phone.
      if (hasFocused.current) void reloadRef.current(true);
      else hasFocused.current = true;
    }, []),
  );
}

export function useResource<T>(
  serverUrl: string,
  path: string | null,
  /**
   * How often to ask again, in milliseconds. Omitted, the answer is fetched
   * once — which is right for a folder's contents and wrong for anything the
   * server changes on its own while the screen is open.
   */
  every?: number | null,
) {
  const [data, setData] = useState<T | null>(null);
  /** The endpoint that produced `data`; never show a prior filter's result. */
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  /**
   * Only the newest request may write to state.
   *
   * Typing in the search box fires a request per keystroke and they do not come
   * back in order — without this, a slow early response lands last and replaces
   * the results for what was actually typed.
   */
  const generation = useRef(0);

  // Part of `reload`'s identity, so the effect below re-runs and refetches the
  // moment anything says the library has moved on.
  const seen = useRevision();

  const reload = useCallback(async (silent = false) => {
    if (path === null) {
      setData(null);
      setLoadedPath(null);
      setLoading(false);
      return;
    }

    const mine = ++generation.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [body, auth] = await Promise.all([
        request<T>(serverUrl, path),
        storedToken(),
      ]);
      if (mine !== generation.current) return;
      setData(body);
      setLoadedPath(path);
      setToken(auth);
    } catch (e) {
      if (mine !== generation.current) return;
      // A server that cannot be reached is announced once by the banner. Every
      // screen also printing its own red line about it was the same news five
      // times over, above a grid that was empty for that very reason.
      setError(reachability === 'reachable' ? (e instanceof Error ? e.message : 'Something went wrong.') : null);
    } finally {
      if (mine === generation.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl, path, seen]);

  /**
   * Asks again on a timer, for answers that go stale by themselves.
   *
   * A face scan started from the web client moves a count this app is already
   * showing, and nothing tells it — so the screen sat there saying photos were
   * waiting long after they had been done.
   */
  useEffect(() => {
    if (!every || path === null) return;
    const timer = setInterval(() => void reload(), every);
    return () => clearInterval(timer);
  }, [every, path, reload]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useReloadOnFocus(reload);

  return { data, loadedPath, token, error, loading, reload };
}

/**
 * A paged resource for long photo collections. Native lists already recycle
 * cells; this keeps their backing array bounded to the pages the user reached
 * instead of downloading a fixed, incomplete first 300 or 500 photos.
 */
export function usePagedResource<T>(
  serverUrl: string,
  path: string | null,
  { size = 150, itemsKey = 'items' }: { size?: number; itemsKey?: PageItemsKey } = {},
) {
  const [items, setItems] = useState<T[]>([]);
  const [pagination, setPagination] = useState<Paged<T>['pagination'] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const page = useRef(0);
  const generation = useRef(0);
  const seen = useRevision();

  const load = useCallback(
    async (nextPage: number, replace: boolean, silent = false) => {
      if (path === null) return;
      const mine = ++generation.current;
      if (replace) {
        if (!silent) setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const separator = path.includes('?') ? '&' : '?';
        const [body, auth] = await Promise.all([
          request<Paged<T> | AssetPage<T>>(
            serverUrl,
            `${path}${separator}page=${nextPage}&size=${size}`,
          ),
          storedToken(),
        ]);
        if (mine !== generation.current) return;
        const nextItems = itemsKey === 'assets'
          ? ('assets' in body ? body.assets : undefined)
          : ('items' in body ? body.items : undefined);
        if (!Array.isArray(nextItems)) {
          throw new Error('The server returned an invalid media page.');
        }
        page.current = body.pagination?.page ?? nextPage;
        setItems((current) => (replace ? nextItems : [...current, ...nextItems]));
        setPagination(body.pagination ?? null);
        setToken(auth);
      } catch (cause) {
        if (mine !== generation.current) return;
        setError(
          reachability === 'reachable'
            ? (cause instanceof Error ? cause.message : 'Something went wrong.')
            : null,
        );
      } finally {
        if (mine === generation.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [itemsKey, path, serverUrl, size],
  );

  const reload = useCallback(async (silent = false) => {
    if (path === null) {
      setItems([]);
      setPagination(null);
      setLoading(false);
      return;
    }
    await load(1, true, silent);
  }, [path, load]);

  useEffect(() => {
    void reload();
  }, [reload, seen]);

  useReloadOnFocus(reload);

  // Not every endpoint supplies `pages`; page, size and total are the stable
  // pagination contract and answer the same question without guessing.
  const hasMore = Boolean(
    pagination && pagination.page * pagination.size < pagination.total,
  );
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    void load(page.current + 1, false);
  }, [hasMore, loadingMore, loading, load]);

  return { items, pagination, token, error, loading, loadingMore, hasMore, reload, loadMore };
}

/** The session token on its own, for screens that only render thumbnails. */
export function useToken() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    void storedToken().then(setToken);
  }, []);
  return token;
}

/**
 * A thumbnail URL and the header that unlocks it.
 *
 * The token stays in a header rather than a query string: URLs end up in server
 * access logs, and a log file full of live session tokens is a credential leak
 * that outlives the session.
 */
export function thumbnail(serverUrl: string, assetId: string, token: string | null) {
  return {
    uri: `${serverUrl}/api/assets/${assetId}/thumbnail`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

/** The cropped image the server keeps as a person's or pet's avatar. */
export function subjectThumbnail(
  serverUrl: string,
  subjectId: string,
  token: string | null,
  thumbnailUpdatedAt?: string,
) {
  return {
    uri: `${serverUrl}/api/people-and-pets/${subjectId}/thumbnail.jpg?v=${encodeURIComponent(thumbnailUpdatedAt ?? '')}`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

/** Turns "00:01:07.400" into "1:07". Anything unparseable is left out. */
export function duration(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(':').map((part) => Number.parseFloat(part));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;

  const [hours, minutes, seconds] = parts;
  const whole = Math.floor(seconds);
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(whole).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
