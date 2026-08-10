import { getItem, removeItem, setItem } from './storage';

const KEY = 'imadeo.server';

export interface ServerInfo {
  url: string;
  version: string;
}

function isLocalAddress(value: string): boolean {
  const host = value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return (
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host) ||
    /^localhost(:\d+)?$/i.test(host) ||
    /\.local(:\d+)?$/i.test(host)
  );
}

/**
 * Fills in what someone typing an address on a phone will leave out.
 *
 * A bare host is not something `fetch` accepts, so default to HTTPS. Sensitive
 * media must never be sent to a public server over plain HTTP. Development can
 * still opt into a LAN address explicitly while using a debug build.
 */
export function normalize(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
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
  if (!__DEV__ && url.startsWith('http://')) {
    throw new Error('Imadeo requires an HTTPS server to protect your private media.');
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    response = await fetch(`${url}/api`, { signal: controller.signal });
    clearTimeout(timer);
  } catch {
    const help = isLocalAddress(url)
      ? 'Check the address and that your phone is on the same network.'
      : 'Check the public address and port forwarding.';
    throw new Error(`Could not reach ${url}. ${help}`);
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
  await setItem(KEY, url);
}

export async function load(): Promise<string | null> {
  return getItem(KEY);
}

export async function forget() {
  await removeItem(KEY);
}
