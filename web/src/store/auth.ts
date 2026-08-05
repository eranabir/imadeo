import { create } from 'zustand';
import { api, tokens } from '../lib/api';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  profileImagePath: string;
  quotaSizeInBytes: string | null;
  quotaUsageInBytes: string;
  shouldChangePassword: boolean;
  /** "google" | "apple" when a provider is linked, null for password-only accounts. */
  oauthProvider: string | null;
  /** Whether a password is set — disconnecting a provider without one locks you out. */
  hasPassword: boolean;
  preferences: {
    theme: 'light' | 'dark' | 'system';
    tileSize: number;
    showAssetsInSubfolders: boolean;
    timelineLayout: 'justified' | 'grid';
    autoplayVideos: boolean;
    loopVideos: boolean;
    videoQuality: 'original' | 'transcoded';
    showMemories: boolean;
    locale: string;
  };
}

interface AuthState {
  user: CurrentUser | null;
  /** Null until the first session check finishes, so routes can wait. */
  status: 'unknown' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  setUser: (user: CurrentUser) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'unknown',

  async login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    tokens.set(data.accessToken, data.refreshToken);
    const { data: user } = await api.get<CurrentUser>('/users/me');
    set({ user, status: 'authenticated' });
  },

  async logout() {
    await api.post('/auth/logout').catch(() => undefined);
    tokens.clear();
    set({ user: null, status: 'anonymous' });
  },

  async restore() {
    if (!tokens.access && !tokens.refresh) {
      set({ status: 'anonymous' });
      return;
    }
    try {
      const { data } = await api.get<CurrentUser>('/users/me');
      set({ user: data, status: 'authenticated' });
    } catch {
      tokens.clear();
      set({ user: null, status: 'anonymous' });
    }
  },

  setUser: (user) => set({ user }),
}));
