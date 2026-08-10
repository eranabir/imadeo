import { getItem, removeItem, setItem } from './storage';

const KEY = 'imadeo.server';

export interface ServerInfo {
  url: string;
  version: string;
}

function hostOf(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

function isLocalAddress(value: string): boolean {
  const host = hostOf(value);
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    /^localhost$/i.test(host) ||
    /\.local$/i.test(host)
  );
}

/** RFC 1918, loopback, and CGNAT addresses used by LANs and common VPNs. */
function isPrivateNetworkAddress(value: string): boolean {
  const parts = hostOf(value).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return /^localhost$/i.test(hostOf(value)) || /\.local$/i.test(hostOf(value));
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

/**
 * Fills in what someone typing an address on a phone will leave out.
 *
 * A bare host is not something `fetch` accepts. Private LAN/VPN addresses use
 * HTTP by default; public hosts use HTTPS so private media is never sent over
 * an unencrypted internet connection.
 */
export function normalize(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${isPrivateNetworkAddress(trimmed) ? 'http' : 'https'}://${trimmed}`;
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
  if (!__DEV__ && url.startsWith('http://') && !isPrivateNetworkAddress(url)) {
    throw new Error('Use HTTPS for a public server. HTTP is only allowed on a private LAN or VPN.');
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
