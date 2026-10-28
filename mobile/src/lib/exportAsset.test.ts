import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  download: vi.fn(), remove: vi.fn(), mkdir: vi.fn(), share: vi.fn(), save: vi.fn(),
  available: vi.fn(), token: vi.fn(), generation: vi.fn(), permission: vi.fn(),
}));
vi.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', downloadAsync: mocks.download,
  deleteAsync: mocks.remove, makeDirectoryAsync: mocks.mkdir }));
vi.mock('expo-media-library/legacy', () => ({ saveToLibraryAsync: mocks.save, requestPermissionsAsync: mocks.permission }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: mocks.available, shareAsync: mocks.share }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('./auth', () => ({ ensureFreshToken: mocks.token, sessionGeneration: mocks.generation }));
import { exportAsset } from './exportAsset';
const asset = { id: 'photo', ownerId: 'owner', type: 'IMAGE' as const, originalFileName: 'original.heic' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.available.mockResolvedValue(true);
  mocks.token.mockResolvedValue('private-token');
  mocks.generation.mockReturnValue(1);
  mocks.download.mockResolvedValue({ status: 200, uri: 'file:///cache/original.heic' });
  mocks.remove.mockResolvedValue(undefined);
});
it('shares the authenticated original file and removes the temporary copy', async () => {
  await exportAsset('https://photos.example', asset, 'share');
  expect(mocks.download).toHaveBeenCalledWith('https://photos.example/api/assets/photo/download',
    expect.stringMatching(/original\.heic$/), { headers: { Authorization: 'Bearer private-token' } });
  expect(mocks.share).toHaveBeenCalledWith('file:///cache/original.heic');
  expect(mocks.remove).toHaveBeenCalled();
});
it('saves to Photos without asking for read access on iOS', async () => {
  await exportAsset('https://photos.example', asset, 'download');
  expect(mocks.save).toHaveBeenCalledWith('file:///cache/original.heic');
  expect(mocks.permission).not.toHaveBeenCalled();
});
it('never exports an error response and cleans up', async () => {
  mocks.download.mockResolvedValue({ status: 403, uri: 'file:///error' });
  await expect(exportAsset('https://photos.example', asset, 'share')).rejects.toThrow('could not be downloaded');
  expect(mocks.share).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalled();
});
it('removes partial downloads after network failures', async () => {
  mocks.download.mockRejectedValue(new Error('Offline'));
  await expect(exportAsset('https://photos.example', asset, 'download')).rejects.toThrow('Offline');
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalled();
});
it('does not export if the account changed during download', async () => {
  mocks.generation.mockReturnValueOnce(1).mockReturnValue(2);
  await expect(exportAsset('https://photos.example', asset, 'share')).rejects.toThrow('session changed');
  expect(mocks.share).not.toHaveBeenCalled();
});
it('cleans up when the share sheet fails', async () => {
  mocks.share.mockRejectedValue(new Error('Sharing failed'));
  await expect(exportAsset('https://photos.example', asset, 'share')).rejects.toThrow('Sharing failed');
  expect(mocks.remove).toHaveBeenCalled();
});
