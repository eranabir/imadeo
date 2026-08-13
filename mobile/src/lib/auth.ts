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
  cached = body.accessToken;
  return body as Session;
}

export async function storedToken() {
  if (cached) return cached;
  cached = await getItem(ACCESS);
  return cached;
}

export async function signOut() {
  cached = null;
  await Promise.all([
    removeItem(ACCESS),
    removeItem(REFRESH),
  ]);
}
