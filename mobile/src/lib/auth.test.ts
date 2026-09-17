import { beforeEach, describe, expect, it, vi } from 'vitest';
const values = new Map<string, string>();
vi.mock('./storage', () => ({
  getItem: vi.fn(async (key: string) => values.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { values.delete(key); }),
}));
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { vi.resetModules(); values.clear(); values.set('imadeo.server.active', 'nas'); vi.stubGlobal('fetch', vi.fn()); });
async function signedIn() {
  const auth = await import('./auth');
  vi.mocked(fetch).mockResolvedValueOnce(reply({ accessToken: 'access', refreshToken: 'refresh' }));
  await auth.login('https://external', 'user', 'password');
  return auth;
}
describe('durable native session', () => {
  it('retries a lost refresh response at the internal address with the same operation id', async () => {
    const auth = await signedIn();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('socket lost'));
    await expect(auth.refreshToken('https://external')).rejects.toMatchObject({ unreachable: true });
    expect(await auth.storedToken()).toBe('access');
    const first = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    // Relaunch with the pending rotation still in secure storage.
    vi.resetModules();
    const relaunched = await import('./auth');
    vi.mocked(fetch).mockResolvedValueOnce(reply({ accessToken: 'next', refreshToken: 'next-refresh' }));
    await expect(relaunched.refreshToken('http://internal')).resolves.toBe('next');
    expect(JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string)).toEqual(first);
    expect(JSON.parse(values.get('imadeo.session.v3')!)).not.toHaveProperty('requestId');
  });
  it('does not erase credentials on proxy 403', async () => {
    const auth = await signedIn();
    vi.mocked(fetch).mockResolvedValueOnce(reply({ message: 'Cross-site blocked' }, 403));
    await expect(auth.refreshToken('https://external')).rejects.toThrow('Cross-site');
    expect(await auth.storedToken()).toBe('access');
  });
  it('recovers if secure storage fails after the server has rotated the token', async () => {
    const auth = await signedIn();
    const storage = await import('./storage');
    let failOnce = true;
    vi.mocked(storage.setItem).mockImplementation(async (key, value) => {
      if (key === 'imadeo.session.v3' && JSON.parse(value).accessToken === 'next' && failOnce) {
        failOnce = false; throw Error('Keychain temporarily unavailable');
      }
      values.set(key, value);
    });
    vi.mocked(fetch).mockImplementation(async () => reply({ accessToken: 'next', refreshToken: 'next-refresh' }));
    await expect(auth.refreshToken('https://external')).rejects.toThrow('Keychain');
    await expect(auth.refreshToken('http://internal')).resolves.toBe('next');
    const calls = vi.mocked(fetch).mock.calls.slice(1);
    expect(calls[0][1]!.body).toBe(calls[1][1]!.body);
  });
  it('clears a server-revoked session', async () => {
    const auth = await signedIn();
    vi.mocked(fetch).mockResolvedValueOnce(reply({}, 401));
    await expect(auth.refreshToken('https://external')).rejects.toThrow('expired');
    expect(await auth.storedToken()).toBeNull();
  });
  it('shares concurrent rotations', async () => {
    const auth = await signedIn();
    vi.mocked(fetch).mockResolvedValueOnce(reply({ accessToken: 'next', refreshToken: 'next-refresh' }));
    expect(await Promise.all([auth.refreshToken('https://external'), auth.refreshToken('http://internal')])).toEqual(['next', 'next']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('cannot restore a session after logout while a response is in flight', async () => {
    const auth = await signedIn();
    let resolve!: (r: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const pending = auth.refreshToken('https://external');
    const rejected = expect(pending).rejects.toThrow('changed');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    await auth.signOut();
    resolve(reply({ accessToken: 'late', refreshToken: 'late' }));
    await rejected;
    expect(await auth.storedToken()).toBeNull();
    expect(values.has('imadeo.session.v3')).toBe(false);
  });
  it('migrates the existing login atomically and binds it to the server profile, not its URL', async () => {
    values.set('imadeo.access', 'old-access'); values.set('imadeo.refresh', 'old-refresh');
    const auth = await import('./auth');
    expect(await auth.storedToken()).toBe('old-access');
    expect(JSON.parse(values.get('imadeo.session.v3')!).serverId).toBe('nas');
    values.set('imadeo.server.active', 'another-server'); vi.resetModules();
    expect(await (await import('./auth')).storedToken()).toBeNull();
  });
});
