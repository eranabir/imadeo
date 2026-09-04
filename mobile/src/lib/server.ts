import { getItem, removeItem, setItem } from './storage';
import { STORAGE_KEYS } from './storageKeys';

const LEGACY_KEY = STORAGE_KEYS.legacyServer;
const SERVERS_KEY = STORAGE_KEYS.servers;
const ACTIVE_KEY = STORAGE_KEYS.activeServer;

/** A saved Imadeo installation, independent of the network currently in use. */
export interface ServerProfile {
  id: string;
  name: string;
  /** A URL which works everywhere, normally the public HTTPS address. */
  externalUrl?: string;
  /** A faster LAN URL, used only while the phone is on one of `ssids`. */
  internalUrl?: string;
  ssids: string[];
  version: string;
}

/** A saved server plus the address selected for the phone's current network. */
export interface ServerInfo extends ServerProfile {
  url: string;
  connectedVia: 'internal' | 'external';
}

export function isLocalAddress(value: string): boolean {
  const host = value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return (
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host) ||
    /^localhost(:\d+)?$/i.test(host) ||
    /\.local(:\d+)?$/i.test(host)
  );
}

/** Fills in the scheme people commonly leave out when typing an address. */
export function normalize(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

function makeId(): string {
  return `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Confirms an Imadeo server is actually there before it is offered to someone.
 *
 * A LAN address may intentionally use HTTP behind a trusted home network. A
 * public address must stay HTTPS so private media is never sent in the clear.
 */
export async function probe(input: string): Promise<{ url: string; version: string }> {
  const url = normalize(input);
  if (!url) throw new Error('Enter your server address.');
  if (!__DEV__ && url.startsWith('http://') && !isLocalAddress(url)) {
    throw new Error('Public Imadeo addresses must use HTTPS.');
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

/**
 * Checks every supplied route concurrently and accepts the first working
 * Imadeo server. An unavailable LAN route must not hide a working public one.
 */
export async function probeServerAddresses(values: {
  externalUrl?: string;
  internalUrl?: string;
}): Promise<{ kind: 'external' | 'internal'; url: string; version: string }> {
  const addresses = [
    values.externalUrl?.trim() ? { kind: 'external' as const, value: values.externalUrl } : null,
    values.internalUrl?.trim() ? { kind: 'internal' as const, value: values.internalUrl } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (addresses.length === 0) throw new Error('Enter an internal or external server address.');
  try {
    return await Promise.any(addresses.map(async (address) => ({
      kind: address.kind,
      ...await probe(address.value),
    })));
  } catch (cause) {
    if (cause instanceof AggregateError && cause.errors[0]) throw cause.errors[0];
    throw cause;
  }
}

export function createProfile(
  values: Partial<Omit<ServerProfile, 'version'>> & Pick<ServerProfile, 'version'>,
): ServerProfile {
  const externalUrl = values.externalUrl?.trim() ? normalize(values.externalUrl) : undefined;
  const internalUrl = values.internalUrl?.trim() ? normalize(values.internalUrl) : undefined;
  const primaryUrl = externalUrl ?? internalUrl;
  if (!primaryUrl) throw new Error('Enter an internal or external server address.');

  return {
    id: values.id ?? makeId(),
    name: values.name?.trim() || hostName(primaryUrl),
    externalUrl,
    internalUrl,
    ssids: [...new Set((values.ssids ?? []).map((ssid) => ssid.trim()).filter(Boolean))],
    version: values.version,
  };
}

export function resolveServer(profile: ServerProfile, ssid: string | null): ServerInfo {
  const useInternal = Boolean(
    profile.internalUrl && (!profile.externalUrl || (ssid && profile.ssids.includes(ssid))),
  );
  return {
    ...profile,
    url: useInternal ? profile.internalUrl! : profile.externalUrl!,
    connectedVia: useInternal ? 'internal' : 'external',
  };
}

/** Finds a working route without changing which saved server is selected. */
export async function findReachable(server: ServerInfo): Promise<string | null> {
  const candidates = [...new Set([server.url, server.internalUrl, server.externalUrl].filter(Boolean) as string[])];
  for (const address of candidates) {
    try {
      await probe(address);
      return address;
    } catch {
      // Try the next route to this same installation.
    }
  }
  return null;
}

async function readProfiles(): Promise<ServerProfile[]> {
  const saved = await getItem(SERVERS_KEY);
  if (saved) {
    try {
      const value = JSON.parse(saved);
      if (Array.isArray(value)) {
        return value.filter((profile): profile is ServerProfile =>
          Boolean(profile?.id && (profile?.externalUrl || profile?.internalUrl) && profile?.name),
        );
      }
    } catch {
      // A malformed record should not prevent someone from adding a server.
    }
  }

  // One-time migration from the original single-address release.
  const legacyUrl = await getItem(LEGACY_KEY);
  if (!legacyUrl) return [];
  const profile = createProfile({ externalUrl: legacyUrl, version: 'unknown' });
  await Promise.all([
    setItem(SERVERS_KEY, JSON.stringify([profile])),
    setItem(ACTIVE_KEY, profile.id),
    removeItem(LEGACY_KEY),
  ]);
  return [profile];
}

export async function listServers(): Promise<ServerProfile[]> {
  return readProfiles();
}

export async function activeServerId(): Promise<string | null> {
  return getItem(ACTIVE_KEY);
}

export async function loadActiveServer(ssid: string | null): Promise<ServerInfo | null> {
  const [profiles, activeId] = await Promise.all([readProfiles(), activeServerId()]);
  const profile = profiles.find((item) => item.id === activeId) ?? profiles[0];
  if (!profile) return null;
  if (profile.id !== activeId) await setItem(ACTIVE_KEY, profile.id);
  return resolveServer(profile, ssid);
}

export async function saveServer(profile: ServerProfile): Promise<void> {
  const profiles = await readProfiles();
  const next = [...profiles.filter((item) => item.id !== profile.id), profile];
  await setItem(SERVERS_KEY, JSON.stringify(next));
}

export async function setActiveServer(id: string): Promise<void> {
  await setItem(ACTIVE_KEY, id);
}

export async function removeServer(id: string): Promise<void> {
  const profiles = await readProfiles();
  const next = profiles.filter((profile) => profile.id !== id);
  await setItem(SERVERS_KEY, JSON.stringify(next));
  if ((await activeServerId()) === id) {
    if (next[0]) await setItem(ACTIVE_KEY, next[0].id);
    else await removeItem(ACTIVE_KEY);
  }
}

/** The selected server for background work, using its external route by default. */
export async function load(): Promise<ServerInfo | null> {
  return loadActiveServer(null);
}

/** Persists an updated active server while keeping the profile storage private. */
export async function save(server: ServerInfo): Promise<void> {
  await saveServer({
    id: server.id,
    name: server.name,
    externalUrl: server.externalUrl,
    internalUrl: server.internalUrl,
    ssids: server.ssids,
    version: server.version,
  });
}

/** Kept for callers that explicitly remove every configured server. */
export async function forget(): Promise<void> {
  await Promise.all([removeItem(LEGACY_KEY), removeItem(SERVERS_KEY), removeItem(ACTIVE_KEY)]);
}
