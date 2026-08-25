import { getItem, removeItem, setItem } from './storage';

const KEY = 'imadeo.server';

export interface ServerInfo {
  url: string;
  version: string;
  /** Every route to this one workspace, with the currently working one first. */
  addresses: string[];
}

function uniqueAddresses(values: string[]): string[] {
  return [...new Set(values.map(normalize).filter(Boolean))];
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
  const candidates = [normalize(input)].filter(Boolean);
  const enteredUrl = candidates[0];
  if (!enteredUrl) throw new Error('Enter your server address.');
  if (!__DEV__ && enteredUrl.startsWith('http://') && !isPrivateNetworkAddress(enteredUrl)) {
    throw new Error('Use HTTPS for a public server. HTTP is only allowed on a private LAN or VPN.');
  }

  const result = await new Promise<ServerInfo | null>((resolve) => {
    let remaining = candidates.length;
    let settled = false;
    for (const url of candidates) {
      void fetchApiRoot(url, 8000)
        .then(async (response) => {
          if (!response.ok) return null;
          const body = await response.json().catch(() => null);
          if (typeof body?.message !== 'string' || !body.message.includes('Imadeo')) return null;
          return {
            url,
            version: typeof body.version === 'string' ? body.version : 'unknown',
            addresses: [url],
          } satisfies ServerInfo;
        })
        .catch(() => null)
        .then((server) => {
          if (settled) return;
          if (server) {
            settled = true;
            resolve(server);
            return;
          }
          remaining -= 1;
          if (remaining === 0) resolve(null);
        });
    }
  });

  if (result) return result;
  const help = isLocalAddress(enteredUrl)
    ? 'Check the address and that your phone is on the same network.'
    : 'Check the public address and port forwarding.';
  throw new Error(`Could not reach ${enteredUrl}. ${help}`);
}

async function fetchApiRoot(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(`${url}/api`, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function isImadeo(url: string, timeout: number): Promise<boolean> {
  try {
    const response = await fetchApiRoot(url, timeout);
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return typeof body?.message === 'string' && body.message.includes('Imadeo');
  } catch {
    return false;
  }
}

/** Finds the first route that currently reaches this workspace. */
export async function findReachable(server: ServerInfo): Promise<string | null> {
  const addresses = uniqueAddresses([server.url, ...server.addresses]);
  if (addresses.length === 0) return null;

  return new Promise((resolve) => {
    let remaining = addresses.length;
    let settled = false;
    for (const address of addresses) {
      void isImadeo(address, 4000).then((reachable) => {
        if (settled) return;
        if (reachable) {
          settled = true;
          resolve(address);
          return;
        }
        remaining -= 1;
        if (remaining === 0) resolve(null);
      });
    }
  });
}

/** Proves that an added address reaches the signed-in user's same workspace. */
export async function verifyWorkspaceAddress(
  input: string,
  accessToken: string,
  expectedUserId: string,
): Promise<ServerInfo> {
  const candidate = await probe(input);
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    response = await fetch(`${candidate.url}/api/users/me`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-imadeo-client': 'native',
      },
    });
  } catch {
    throw new Error(`Could not verify ${candidate.url}.`);
  } finally {
    clearTimeout(timer);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.id !== expectedUserId) {
    throw new Error('That address does not belong to this signed-in workspace.');
  }
  return candidate;
}

export async function save(server: ServerInfo) {
  const addresses = uniqueAddresses([server.url, ...server.addresses]);
  await setItem(KEY, JSON.stringify({ ...server, url: addresses[0], addresses }));
}

export async function load(): Promise<ServerInfo | null> {
  const raw = await getItem(KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ServerInfo>;
    if (typeof parsed.url !== 'string') throw new Error('invalid server');
    const addresses = uniqueAddresses([
      parsed.url,
      ...(Array.isArray(parsed.addresses) ? parsed.addresses : []),
    ]);
    if (addresses.length === 0) return null;
    return {
      url: addresses[0],
      version: typeof parsed.version === 'string' ? parsed.version : 'unknown',
      addresses,
    };
  } catch {
    // Before workspaces supported alternate routes, this value was one URL.
    const url = normalize(raw);
    return url ? { url, version: 'unknown', addresses: [url] } : null;
  }
}

export async function forget() {
  await removeItem(KEY);
}
