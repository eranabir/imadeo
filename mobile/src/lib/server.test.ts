import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProfile, findReachable, resolveServer, isLocalAddress } from './server';
vi.mock('./storage', () => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }));
const profile = createProfile({ id: 'nas', name: 'Home NAS', version: 'test', internalUrl: 'http://192.168.0.16:1111', externalUrl: 'https://eran.ddns.net:11111', ssids: ['home'] });
const up = () => new Response(JSON.stringify({ message: 'Imadeo is up' }));
beforeEach(() => { vi.stubGlobal('__DEV__', false); vi.stubGlobal('fetch', vi.fn()); });
describe('two routes, one server identity', () => {
  it('permits only private/local HTTP addresses, not arbitrary public IPs', () => {
    for (const url of ['192.168.0.16:1111','10.1.2.3','172.16.1.1','127.0.0.1','[fd12::1]','[::1]','nas.local']) expect(isLocalAddress(url)).toBe(true);
    for (const url of ['8.8.8.8','172.32.0.1','eran.ddns.net','[2001:db8::1]']) expect(isLocalAddress(url)).toBe(false);
  });
  it('falls back to the public route when the stored LAN route fails', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => { if (String(url).startsWith(profile.internalUrl!)) throw Error('no LAN'); return up(); });
    expect(await findReachable(resolveServer(profile, 'home'))).toBe(profile.externalUrl);
  });
  it('returns home without requiring SSID permission or another login', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => { if (String(url).startsWith(profile.externalUrl!)) throw Error('no hairpin route'); return up(); });
    const selected = resolveServer(profile, null);
    expect(await findReachable(selected)).toBe(profile.internalUrl);
    expect(selected.id).toBe(profile.id);
  });
  it('does not let a stalled internal probe delay a healthy public endpoint', async () => {
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).startsWith(profile.externalUrl!)) return up();
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Error('timeout'))));
    });
    expect(await findReachable(resolveServer(profile, 'home'))).toBe(profile.externalUrl);
  });
  it('keeps the same profile across known Wi-Fi, unknown Wi-Fi and mobile data', () => {
    for (const ssid of ['home', 'other', null]) expect(resolveServer(profile, ssid).id).toBe('nas');
  });
});
