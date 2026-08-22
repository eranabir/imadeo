import axios, { AxiosError, type AxiosInstance } from 'axios';

export const api: AxiosInstance = axios.create({
  baseURL: '/api',
  withCredentials: true,
  // The browser authenticates only with HttpOnly cookies. This marker lets
  // the API avoid returning bearer tokens to JavaScript while mobile clients
  // continue to receive the tokens they store in the device keychain.
  headers: { 'X-Imadeo-Client': 'web' },
});

const ACCESS_KEY = 'imadeo.accessToken';
const REFRESH_KEY = 'imadeo.refreshToken';

/** Removes tokens written by pre-cookie-only releases. Never store new ones. */
export const clearLegacyTokens = () => {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
};

// A single in-flight refresh, shared by every request that got a 401 at once.
let refreshing: Promise<void> | null = null;
let lastSuccessfulRefresh = 0;
const UPLOAD_SESSION_FRESHNESS_MS = 5 * 60 * 1000;

function refreshBrowserSession() {
  refreshing ??= axios
    .post('/api/auth/refresh', undefined, {
      withCredentials: true,
      headers: { 'X-Imadeo-Client': 'web' },
    })
    .then(() => {
      lastSuccessfulRefresh = Date.now();
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function refreshSessionWasRejected(error: unknown) {
  const status = error instanceof AxiosError ? error.response?.status : undefined;
  return status === 401 || status === 403;
}

async function browserAccessSessionIsValid() {
  try {
    await axios.get('/api/users/me', {
      withCredentials: true,
      headers: { 'X-Imadeo-Client': 'web' },
    });
    return true;
  } catch {
    return false;
  }
}

function expireBrowserSession() {
  clearLegacyTokens();
  window.location.href = '/login';
}

/** Ensures a large request starts with an access token that has ample life left. */
export async function ensureFreshBrowserSession(maxAgeMs = UPLOAD_SESSION_FRESHNESS_MS) {
  if (maxAgeMs > 0 && Date.now() - lastSuccessfulRefresh < maxAgeMs) return;
  try {
    await refreshBrowserSession();
  } catch (error) {
    // Losing Wi-Fi, changing server addresses, or a temporary 5xx must keep
    // the signed-in state intact. Only the server rejecting the refresh token
    // proves that the session has actually ended.
    if (refreshSessionWasRejected(error)) {
      // Refresh tokens rotate. Two tabs can submit the same old token at once:
      // one rotates it successfully while the other receives 403. Do not turn
      // that harmless race into a login loop while the access cookie still
      // proves that this browser is signed in.
      if (await browserAccessSessionIsValid()) {
        lastSuccessfulRefresh = Date.now();
        return;
      }
      expireBrowserSession();
    }
    throw error;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as (typeof error.config & { _retried?: boolean }) | undefined;

    // Auth endpoints must report their own 401s. `/users/me`, however, is the
    // startup session probe: it should try the refresh cookie before deciding
    // the browser is anonymous, but a failed refresh must not bypass first-run
    // setup by forcing a redirect to Login.
    const isAuthRequest = request?.url?.startsWith('/auth/');
    const isSessionProbe = request?.url === '/users/me';
    if (error.response?.status !== 401 || !request || request._retried || isAuthRequest) {
      throw error;
    }

    request._retried = true;

    try {
      await refreshBrowserSession();
    } catch (refreshError) {
      if (refreshSessionWasRejected(refreshError)) {
        clearLegacyTokens();
        if (!isSessionProbe) window.location.href = '/login';
      }
      throw refreshError;
    }
    return api.request(request);
  },
);

/** Turns an axios failure into something worth showing a person. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join(', ');
    if (data?.message) return data.message;
    if (error.code === 'ERR_NETWORK') return 'Cannot reach the server';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
};

export const errorStatus = (error: unknown) =>
  error instanceof AxiosError ? error.response?.status : undefined;

/**
 * Media URLs go into `<img>` and `<video>` tags, which cannot send an
 * Authorization header. They authenticate with the httpOnly cookie the login
 * and refresh endpoints set instead, which works because the dev proxy and the
 * production nginx both serve the API from the same origin as the app.
 */
export const mediaUrl = (assetId: string, kind: 'thumbnail' | 'preview' | 'original' | 'video') => {
  if (kind === 'preview') return `/api/assets/${assetId}/thumbnail?size=preview`;
  if (kind === 'thumbnail') return `/api/assets/${assetId}/thumbnail`;
  return `/api/assets/${assetId}/${kind}`;
};
