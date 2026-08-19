import { getItem, removeItem, setItem } from './storage';

const ACCESS = 'imadeo.access';
const REFRESH = 'imadeo.refresh';

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
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/auth/login`, {
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
  if (!body?.accessToken) throw new Error('The server did not return a session.');

  await setItem(ACCESS, body.accessToken);
  if (body.refreshToken) await setItem(REFRESH, body.refreshToken);
  lastSuccessfulRefresh = Date.now();
  setCachedToken(body.accessToken);
  return body as Session;
}

export async function storedToken() {
  if (cached) return cached;
  setCachedToken(await getItem(ACCESS));
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

export async function expireSession() {
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

  refreshing = (async () => {
    const refresh = await getItem(REFRESH);
    if (!refresh) {
      await expireSession();
      throw new SessionRefreshError('Your session has expired. Please sign in again.', false);
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-imadeo-client': 'native' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
    } catch {
      throw new SessionRefreshError('Could not reach your server. Check your connection.', true);
    }

    const body = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      await expireSession();
      throw new SessionRefreshError('Your session has expired. Please sign in again.', false);
    }
    if (!response.ok) {
      const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
      throw new SessionRefreshError(message ?? `Session refresh failed (${response.status}).`, false);
    }
    if (!body?.accessToken || !body?.refreshToken) {
      throw new SessionRefreshError('The server returned an invalid session.', false);
    }

    await Promise.all([
      setItem(ACCESS, body.accessToken),
      setItem(REFRESH, body.refreshToken),
    ]);
    lastSuccessfulRefresh = Date.now();
    setCachedToken(body.accessToken);
    return body.accessToken as string;
  })().finally(() => {
    refreshing = null;
  });

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
  setCachedToken(null);
  refreshing = null;
  lastSuccessfulRefresh = 0;
  await Promise.all([
    removeItem(ACCESS),
    removeItem(REFRESH),
  ]);
}
