import * as SecureStore from 'expo-secure-store';

const KEY = 'imadeo.server';

export interface ServerInfo {
  url: string;
  version: string;
}

/**
 * Fills in what someone typing an address on a phone will leave out.
 *
 * Self-hosters reach their server as `192.168.1.40:3001` or `photos.example.com`
 * far more often than as a full URL, and a bare host is not something `fetch`
 * will accept. Plain http is assumed for anything that looks like a LAN
 * address, because a home server rarely has a certificate.
 */
export function normalize(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const isLan =
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(trimmed) ||
    /^localhost(:\d+)?$/i.test(trimmed) ||
    /\.local(:\d+)?$/i.test(trimmed);

  return `${isLan ? 'http' : 'https'}://${trimmed}`;
}

/**
 * Confirms an Imadeo server is actually there.
 *
 * Checks the body rather than the status code: a 200 only proves *something*
 * answered, and a router login page or an unrelated service would sail through.
 * The greeting is what identifies the server as ours.
 */
export async function probe(input: string): Promise<ServerInfo> {
  const url = normalize(input);
  if (!url) throw new Error('Enter your server address.');

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    response = await fetch(`${url}/api`, { signal: controller.signal });
    clearTimeout(timer);
  } catch {
    throw new Error(`Could not reach ${url}. Check the address and that you are on the same network.`);
  }

  if (!response.ok) {
    throw new Error(`${url} answered with ${response.status}. That does not look like an Imadeo server.`);
  }

  const body = await response.json().catch(() => null);
  if (!body || typeof body.message !== 'string' || !body.message.includes('Imadeo')) {
    throw new Error(`Something is running at ${url}, but it is not Imadeo.`);
  }

  return { url, version: typeof body.version === 'string' ? body.version : 'unknown' };
}

export async function save(url: string) {
  await SecureStore.setItemAsync(KEY, url);
}

export async function load(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function forget() {
  await SecureStore.deleteItemAsync(KEY);
}
