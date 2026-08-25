import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { useAuth, type CurrentUser } from './auth';

const user: CurrentUser = {
  id: 'user-1',
  email: 'person@example.com',
  name: 'Person',
  isAdmin: true,
  profileImagePath: '',
  quotaSizeInBytes: null,
  quotaUsageInBytes: '0',
  shouldChangePassword: false,
  oauthProvider: null,
  hasPassword: true,
  preferences: {
    theme: 'system',
    tileSize: 235,
    showAssetsInSubfolders: true,
    timelineLayout: 'justified',
    autoplayVideos: true,
    loopVideos: false,
    videoQuality: 'transcoded',
    showMemories: true,
    locale: 'en',
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({ user: null, status: 'unknown' });
});

describe('login', () => {
  it('uses the user returned by login without a second blocking request', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { user } });
    const get = vi.spyOn(api, 'get');

    await useAuth.getState().login(user.email, 'password');

    expect(post).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
    expect(useAuth.getState()).toMatchObject({ user, status: 'authenticated' });
  });
});
