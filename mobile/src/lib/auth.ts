import * as SecureStore from 'expo-secure-store';

const ACCESS = 'imadeo.access';
const REFRESH = 'imadeo.refresh';

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name?: string };
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
      headers: { 'Content-Type': 'application/json' },
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

  await SecureStore.setItemAsync(ACCESS, body.accessToken);
  if (body.refreshToken) await SecureStore.setItemAsync(REFRESH, body.refreshToken);
  return body as Session;
}

export async function storedToken() {
  return SecureStore.getItemAsync(ACCESS);
}

export async function signOut() {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS),
    SecureStore.deleteItemAsync(REFRESH),
  ]);
}
