import { getItem, removeItem, setItem } from './storage';
import { STORAGE_KEYS } from './storageKeys';

const ACCESS = STORAGE_KEYS.access;
const REFRESH = STORAGE_KEYS.refresh;
const SESSION = STORAGE_KEYS.session;
interface StoredSession { accessToken: string; refreshToken: string; serverId: string | null; requestId?: string }
let generation = 0;
let storageWrites: Promise<unknown> = Promise.resolve();

// Serialize logout and credential commits: a late response cannot restore an
// account after the user has signed out or selected a different server.
function commit(value: StoredSession | null, expected: number) {
  const operation = storageWrites.catch(() => undefined).then(async () => {
    if (expected !== generation) throw new Error('The selected session changed.');
    if (value) await setItem(SESSION, JSON.stringify(value));
    else await removeItem(SESSION);
    await Promise.all([removeItem(ACCESS), removeItem(REFRESH)]);
  });
  storageWrites = operation;
  return operation;
}

async function readSession(): Promise<StoredSession | null> {
  const expected = generation;
  await storageWrites.catch(() => undefined);
  const serverId = await getItem(STORAGE_KEYS.activeServer);
  const raw = await getItem(SESSION);
  if (raw) {
    const session = JSON.parse(raw) as StoredSession;
    return session.serverId === serverId ? session : null;
  }
  const [accessToken, refreshToken] = await Promise.all([getItem(ACCESS), getItem(REFRESH)]);
  if (!accessToken || !refreshToken) return null;
  const session = { accessToken, refreshToken, serverId };
  await commit(session, expected);
  return session;
}

async function authFetch(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try { return await fetch(url, { ...init, credentials: 'omit', signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

/**
 * The access token, held in memory once it has been read.
 *
 * Every thumbnail on every grid carries it as a header. Without this a screen
 * of 200 tiles is 200 trips to the Keychain, each of them asynchronous, and the
 * grid renders in visible waves as they resolve.
 *
 * Kept here rather than beside the callers so that `signOut` cannot forget to
 * invalidate it — the cache and the store it mirrors change in the same place.
 */
let cached: string | null = null;
let refreshing: Promise<string> | null = null;
let lastSuccessfulRefresh = 0;
const expiredListeners = new Set<() => void>();
const tokenListeners = new Set<(token: string | null) => void>();
const TOKEN_FRESHNESS_MS = 5 * 60 * 1000;

function setCachedToken(token: string | null) {
  cached = token;
  for (const listener of tokenListeners) listener(token);
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name?: string };
}

export interface RegistrationStatus {
  allowed: boolean;
  isFirstUser: boolean;
}

/** Returns whether this empty server still needs its first administrator. */
export async function registrationStatus(baseUrl: string): Promise<RegistrationStatus> {
  const response = await fetch(`${baseUrl}/api/auth/registration`);
  if (!response.ok) throw new Error(`Could not check registration (${response.status}).`);

  const body = await response.json().catch(() => null);
  if (typeof body?.isFirstUser !== 'boolean') throw new Error('Invalid registration response.');
  return body as RegistrationStatus;
}

/**
 * Exchanges credentials for a session against whichever server was configured.
 *
 * The web client leans on cookies the server sets; a native app cannot, so the
 * tokens in the response body are what matter here. They go to the Keychain on
 * iOS and the Keystore on Android — never AsyncStorage, which is plain text on
 * a rooted device.
 */
export async function login(baseUrl: string, email: string, password: string): Promise<Session> {
  const expected = generation;
  let response: Response;
  try {
    response = await authFetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-imadeo-client': 'native' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }

  if (response.status === 401) throw new Error('That email and password do not match.');

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message ?? `Sign in failed (${response.status}).`);
  }
  if (!body?.accessToken || !body?.refreshToken) throw new Error('The server did not return a session.');

  await commit({ accessToken: body.accessToken, refreshToken: body.refreshToken,
    serverId: await getItem(STORAGE_KEYS.activeServer) }, expected);
  if (expected !== generation) throw new Error('The selected session changed.');
  lastSuccessfulRefresh = Date.now();
  setCachedToken(body.accessToken);
  return body as Session;
}

export async function storedToken() {
  if (cached) return cached;
  const expected = generation;
  const session = await readSession();
  if (expected !== generation) return null;
  setCachedToken(session?.accessToken ?? null);
  return cached;
}

/** Updates image/video request headers whenever a refresh rotates the token. */
export function onTokenChanged(listener: (token: string | null) => void) {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

/**
 * Lets the app shell leave its signed-in state when the server rejects the
 * refresh token. Individual screens must not each decide whether the session
 * exists: that is how one tab kept cached faces while another looked empty.
 */
export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

export class SessionRefreshError extends Error {
  constructor(
    message: string,
    readonly unreachable: boolean,
  ) {
    super(message);
    this.name = 'SessionRefreshError';
  }
}

export async function expireSession(expected = generation) {
  if (expected !== generation) return;
  // Move the shell to sign-in before waiting for Keychain/Keystore writes. No
  // authenticated screen should survive while secure storage is being cleared.
  for (const listener of expiredListeners) listener();
  await signOut();
}

/**
 * Exchanges the long-lived native refresh token for a fresh access token.
 *
 * Every tab can discover an expired access token at once, so the exchange is
 * shared. Refresh tokens rotate; sending the old one twice would invalidate
 * the second request and incorrectly return the whole app to sign-in.
 */
export async function refreshToken(baseUrl: string): Promise<string> {
  if (refreshing) return refreshing;

  const expected = generation;
  const operation = (async () => {
    const session = await readSession();
    if (!session) {
      await expireSession(expected);
      throw new SessionRefreshError('Your session has expired. Please sign in again.', false);
    }

    // Persist BEFORE sending, and retain on timeout or response/storage loss.
    // A retry from either address (or after restart) repeats the same rotation.
    const requestId = session.requestId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    await commit({ ...session, requestId }, expected);
    let response: Response;
    try {
      response = await authFetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-imadeo-client': 'native' },
        body: JSON.stringify({ refreshToken: session.refreshToken, requestId }),
      });
    } catch {
      throw new SessionRefreshError('Could not reach your server. Check your connection.', true);
    }

    const body = await response.json().catch(() => null);
    if (expected !== generation) throw new Error('The selected session changed.');
    if (response.status === 401) {
      await expireSession(expected);
      throw new SessionRefreshError('Your session has expired. Please sign in again.', false);
    }
    if (!response.ok) {
      const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
      throw new SessionRefreshError(message ?? `Session refresh failed (${response.status}).`, false);
    }
    if (!body?.accessToken || !body?.refreshToken) {
      throw new SessionRefreshError('The server returned an invalid session.', false);
    }

    await commit({ accessToken: body.accessToken, refreshToken: body.refreshToken,
      serverId: session.serverId }, expected);
    if (expected !== generation) throw new Error('The selected session changed.');
    lastSuccessfulRefresh = Date.now();
    setCachedToken(body.accessToken);
    return body.accessToken as string;
  })().finally(() => {
    if (refreshing === operation) refreshing = null;
  });
  refreshing = operation;
  return refreshing;
}

/** Gives long native operations a fresh token before sending their first byte. */
export async function ensureFreshToken(baseUrl: string, maxAgeMs = TOKEN_FRESHNESS_MS) {
  const token = await storedToken();
  if (!token) {
    await expireSession();
    throw new SessionRefreshError('Your session has expired. Please sign in again.', false);
  }
  if (maxAgeMs > 0 && Date.now() - lastSuccessfulRefresh < maxAgeMs) return token;
  return refreshToken(baseUrl);
}

export async function signOut() {
  generation += 1;
  setCachedToken(null);
  refreshing = null;
  lastSuccessfulRefresh = 0;
  await commit(null, generation);
}

export function sessionGeneration() { return generation; }
