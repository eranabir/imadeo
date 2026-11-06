import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Progress } from './backup';

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  assets: [] as any[],
  device: 'device-a', account: 'account-a', token: '', generation: 1,
  backedUp: new Map<string, string[]>(), excluded: new Map<string, string[]>(),
  request: vi.fn(), upload: vi.fn(), createUpload: vi.fn(), cancel: vi.fn(),
  read: vi.fn(), write: vi.fn(), assetInfo: vi.fn(), getAssets: vi.fn(),
  storedToken: vi.fn(), freshToken: vi.fn(), refreshToken: vi.fn(),
  getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), changed: vi.fn(),
  network: vi.fn(),
}));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: async (uri: string) => ({ exists: state.files.has(uri) }),
  readAsStringAsync: state.read, writeAsStringAsync: state.write,
  createUploadTask: state.createUpload, FileSystemUploadType: { MULTIPART: 1 },
}));
vi.mock('expo-device', () => ({ deviceName: 'Test iPhone' }));
vi.mock('expo-media-library/legacy', () => ({
  getAssetsAsync: state.getAssets, getAssetInfoAsync: state.assetInfo,
  SortBy: { creationTime: 'creationTime' }, MediaType: { video: 'video' },
}));
vi.mock('expo-network', () => ({
  getNetworkStateAsync: state.network, NetworkStateType: { CELLULAR: 'CELLULAR' },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('./api', () => ({ request: state.request, libraryChanged: state.changed }));
vi.mock('./auth', () => ({
  storedToken: state.storedToken, ensureFreshToken: state.freshToken,
  refreshToken: state.refreshToken, sessionGeneration: () => state.generation,
}));
vi.mock('./preferences', () => ({ cellularAllowed: () => ({ photos: false, videos: false }) }));
vi.mock('./storage', () => ({ getItem: state.getItem, setItem: state.setItem, removeItem: state.removeItem }));

const base = 'https://photos.example';
const exclusionsFile = 'file:///documents/backup-exclusions.json';
let backup: typeof import('./backup');
const jwt = (sub: string, iat = 1) => `header.${btoa(JSON.stringify({ sub, iat })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
const scope = (url = base, device = state.device, account = state.account) => JSON.stringify([url, device, account]);
const makeAssets = (count: number) => Array.from({ length: count }, (_, n) => ({
  id: `photo-${n}`, filename: `IMG_${n}.HEIC`, mediaType: 'photo',
  creationTime: 1_700_000_000_000, modificationTime: 1_700_000_000_000,
}));
const excludedResponse = { status: 409, body: JSON.stringify({ code: 'BACKUP_EXCLUDED', message: 'This item is in Trash.' }) };
const savedScopes = () => JSON.parse(state.files.get(exclusionsFile) ?? '[]') as Array<{
  baseUrl: string; deviceId: string; accountId: string; ids: string[];
}>;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.resetModules();
  state.files.clear(); state.backedUp.clear(); state.excluded.clear();
  state.assets = makeAssets(1);
  state.device = 'device-a'; state.account = 'account-a'; state.token = jwt(state.account); state.generation = 1;
  state.getItem.mockImplementation(async (key: string) => key === 'imadeo.deviceId' ? state.device : null);
  state.read.mockImplementation(async (uri: string) => {
    if (!state.files.has(uri)) throw new Error('File not found');
    return state.files.get(uri)!;
  });
  state.write.mockImplementation(async (uri: string, text: string) => { state.files.set(uri, text); });
  state.storedToken.mockImplementation(async () => state.token);
  state.freshToken.mockImplementation(async () => state.token);
  state.refreshToken.mockImplementation(async () => state.token);
  state.network.mockResolvedValue({ type: 'WIFI', isConnected: true });
  state.getAssets.mockImplementation(async () => ({ assets: state.assets, hasNextPage: false, endCursor: '' }));
  state.assetInfo.mockImplementation(async (asset: any) => ({ localUri: `file:///photos/${asset.filename}` }));
  state.request.mockImplementation(async (url: string, path: string) => {
    const device = new URL(path, base).searchParams.get('deviceId')!;
    const key = scope(url, device);
    if (path.startsWith('/assets/backed-up')) return [...(state.backedUp.get(key) ?? [])];
    if (path.startsWith('/assets/backup-exclusions')) return [...(state.excluded.get(key) ?? [])];
    throw new Error(`Unexpected request: ${path}`);
  });
  state.upload.mockImplementation(async (url: string, _uri: string, options: any) => {
    const uploadBase = url.slice(0, -'/api/assets/upload'.length);
    const key = scope(uploadBase, options.parameters.deviceId);
    const id = options.parameters.deviceAssetId;
    state.backedUp.set(key, [...(state.backedUp.get(key) ?? []), id]);
    if (options.parameters.restoreDeletedBackup === 'true') {
      state.excluded.set(key, (state.excluded.get(key) ?? []).filter(value => value !== id));
    }
    return { status: 201, body: '{}' };
  });
  state.createUpload.mockImplementation((url: string, uri: string, options: any) => ({
    uploadAsync: () => state.upload(url, uri, options), cancelAsync: state.cancel,
  }));
  backup = await import('./backup');
});

async function run(only?: string[]) {
  const snapshots: Progress[] = [];
  const result = await backup.runBackup(base, progress => snapshots.push(structuredClone(progress)), () => false, only);
  return { result, snapshots };
}

describe('Trash-aware device backup', () => {
  it('keeps 19 known deleted assets out of the pending count and automatic upload queue', async () => {
    state.assets = makeAssets(19);
    state.excluded.set(scope(), state.assets.map(asset => asset.id));
    expect(await backup.pendingCount(base)).toBe(0);
    const { result } = await run();
    expect(result).toMatchObject({ done: 0, total: 0, failed: 0, held: 0, queue: [], sent: [] });
    expect(state.createUpload).not.toHaveBeenCalled();
    expect(await backup.uploadedIds(base)).toEqual(new Set());
    expect(await backup.excludedBackupIds(base)).toEqual(new Set(state.assets.map(asset => asset.id)));
    expect(state.setItem).not.toHaveBeenCalled();
  });

  it('learns 19 checksum-based exclusions, persists them, and never re-uploads them next run', async () => {
    state.assets = makeAssets(19);
    state.device = 'fresh-install';
    state.upload.mockResolvedValue(excludedResponse);
    const { result } = await run();
    expect(result).toMatchObject({ done: 0, total: 0, failed: 0, held: 0, queue: [], sent: [], at: -1 });
    expect(state.upload).toHaveBeenCalledTimes(19);
    expect(savedScopes()[0]).toMatchObject({ baseUrl: base, deviceId: 'fresh-install', accountId: 'account-a' });
    expect(savedScopes()[0].ids).toHaveLength(19);
    expect(state.files.get(exclusionsFile)).not.toContain(state.token);
    vi.resetModules();
    backup = await import('./backup');
    expect(await backup.pendingCount(base)).toBe(0);
    expect((await run()).result.total).toBe(0);
    expect(state.upload).toHaveBeenCalledTimes(19);
    expect(await backup.uploadedIds(base)).toEqual(new Set());
  });

  it('keeps queue indices correct after a discovered exclusion and leaves real successes intact', async () => {
    state.assets = makeAssets(3);
    state.upload.mockResolvedValueOnce(excludedResponse);
    const { result, snapshots } = await run();
    const sending = snapshots.filter(progress => progress.at >= 0)
      .map(progress => ({ id: progress.queue[progress.at]?.id, at: progress.at, total: progress.total }));
    expect(sending).toContainEqual({ id: 'photo-0', at: 0, total: 3 });
    expect(sending).toContainEqual({ id: 'photo-1', at: 0, total: 2 });
    expect(sending).toContainEqual({ id: 'photo-2', at: 1, total: 2 });
    expect(result).toMatchObject({ done: 2, total: 2, failed: 0, held: 0, sent: ['photo-1', 'photo-2'] });
    expect(result.queue.map(item => item.id)).toEqual(['photo-1', 'photo-2']);
    expect(await backup.uploadedIds(base)).toEqual(new Set(['photo-1', 'photo-2']));
  });

  it('allows explicit restore and clears its cached exclusion only after success', async () => {
    state.upload.mockResolvedValueOnce(excludedResponse);
    await run();
    expect(await backup.excludedBackupIds(base)).toEqual(new Set(['photo-0']));
    const { result } = await run(['photo-0']);
    expect(result).toMatchObject({ done: 1, total: 1, failed: 0 });
    expect(state.createUpload.mock.calls[1][2].parameters.restoreDeletedBackup).toBe('true');
    expect(savedScopes()).toEqual([]);
    expect(await backup.excludedBackupIds(base)).toEqual(new Set());
    expect(await backup.uploadedIds(base)).toEqual(new Set(['photo-0']));
  });

  it('retains the exclusion if an explicit restore fails', async () => {
    state.upload.mockResolvedValueOnce(excludedResponse);
    await run();
    state.upload.mockResolvedValueOnce({ status: 500, body: '{}' });
    expect((await run(['photo-0'])).result.failed).toBe(1);
    expect(await backup.excludedBackupIds(base)).toEqual(new Set(['photo-0']));
  });

  it('partitions cache by exact server address, device, and account while surviving token refresh', async () => {
    state.excluded.set(scope(), ['photo-0']);
    expect(await backup.excludedBackupIds(base)).toEqual(new Set(['photo-0']));
    state.excluded.clear();
    expect(await backup.excludedBackupIds(`${base}/`)).toEqual(new Set());
    state.device = 'device-b';
    expect(await backup.excludedBackupIds(base)).toEqual(new Set());
    state.device = 'device-a'; state.account = 'account-b'; state.token = jwt(state.account); state.generation++;
    expect(await backup.excludedBackupIds(base)).toEqual(new Set());
    state.account = 'account-a'; state.token = jwt(state.account, 2); state.generation++;
    expect(await backup.excludedBackupIds(base)).toEqual(new Set(['photo-0']));
    expect(savedScopes()).toHaveLength(1);
  });

  it('does not persist or reuse exclusions when the account cannot be decoded', async () => {
    state.token = 'opaque-token';
    state.excluded.set(scope(), ['photo-0']);
    expect(await backup.excludedBackupIds(base)).toEqual(new Set(['photo-0']));
    state.excluded.clear();
    expect(await backup.excludedBackupIds(base)).toEqual(new Set());
    expect(state.files.has(exclusionsFile)).toBe(false);
  });

  it('serves cached exclusions offline and removes ids the server reports backed up', async () => {
    state.excluded.set(scope(), ['photo-0']);
    await backup.excludedBackupIds(base);
    state.request.mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Offline'));
    expect(await backup.excludedBackupIds(base)).toEqual(new Set(['photo-0']));
    state.backedUp.set(scope(), ['photo-0']);
    expect(await backup.excludedBackupIds(base)).toEqual(new Set());
    expect(savedScopes()).toEqual([]);
  });

  it('serializes concurrent cache updates for two servers without losing either scope', async () => {
    const other = 'https://other.example';
    state.excluded.set(scope(), ['photo-0']);
    state.excluded.set(scope(other), ['photo-1']);
    await Promise.all([backup.excludedBackupIds(base), backup.excludedBackupIds(other)]);
    expect(savedScopes()).toHaveLength(2);
    expect(savedScopes().flatMap(entry => entry.ids).sort()).toEqual(['photo-0', 'photo-1']);
  });

  it('does not turn cache write failures into upload failures or mark skipped items uploaded', async () => {
    state.write.mockImplementation(async (uri: string, text: string) => {
      if (uri === exclusionsFile) throw new Error('Cache unavailable');
      state.files.set(uri, text);
    });
    state.upload.mockResolvedValueOnce(excludedResponse);
    expect((await run()).result).toMatchObject({ done: 0, failed: 0, held: 0 });
    expect((await run()).result.total).toBe(0);
    expect(state.upload).toHaveBeenCalledOnce();
    expect((await run(['photo-0'])).result).toMatchObject({ done: 1, failed: 0 });
    expect(await backup.uploadedIds(base)).toEqual(new Set(['photo-0']));
  });

  it('leaves ordinary 409 conflicts as visible failures rather than cached exclusions', async () => {
    state.upload.mockResolvedValueOnce({ status: 409, body: JSON.stringify({ message: 'Different conflict' }) });
    expect((await run()).result).toMatchObject({ done: 0, total: 1, failed: 1, held: 0,
      failures: [{ id: 'photo-0', filename: 'IMG_0.HEIC', reason: 'Different conflict' }] });
    expect(await backup.excludedBackupIds(base)).toEqual(new Set());
    expect(await backup.pendingCount(base)).toBe(1);
  });

  it('preserves authentication retry behavior', async () => {
    state.upload.mockResolvedValueOnce({ status: 401, body: '{}' });
    expect((await run()).result).toMatchObject({ done: 1, total: 1, failed: 0 });
    expect(state.refreshToken).toHaveBeenCalledOnce();
    expect(state.upload).toHaveBeenCalledTimes(2);
  });

  it('keeps Wi-Fi holds separate from excluded Trash', async () => {
    state.assets = makeAssets(2);
    state.excluded.set(scope(), ['photo-0']);
    state.network.mockResolvedValue({ type: 'CELLULAR', isConnected: true });
    expect((await run()).result).toMatchObject({ done: 0, total: 0, failed: 0, held: 1, queue: [] });
  });

  it('preserves cancellation of an active native upload without reporting a failure', async () => {
    let finish!: (response: unknown) => void;
    state.upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    state.cancel.mockImplementation(async () => { finish(undefined); });
    const running = backup.runBackup(base, () => {}, () => false);
    await vi.waitFor(() => expect(state.createUpload).toHaveBeenCalledOnce());
    await backup.cancelBackup();
    expect(await running).toMatchObject({ done: 0, failed: 0, at: -1 });
    expect(backup.backupInFlight()).toBe(false);
  });

  it('rejects a Library exclusion result if the account changes during its cache write', async () => {
    state.excluded.set(scope(), ['photo-0']);
    state.write.mockImplementation(async (uri: string, text: string) => {
      state.files.set(uri, text);
      if (uri === exclusionsFile) state.generation++;
    });
    await expect(backup.excludedBackupIds(base)).rejects.toThrow('selected session changed');
  });
});
