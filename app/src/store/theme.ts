import { create } from 'zustand';
import { api } from '../lib/api';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'imadeo.theme';

const resolve = (theme: Theme) =>
  theme === 'dark' ||
  (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

export const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle('dark', resolve(theme));
};

interface ThemeState {
  theme: Theme;
  isDark: boolean;
  setTheme: (theme: Theme, persistToServer?: boolean) => void;
  cycle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const initial = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system';

  // Following the OS means reacting when the OS changes while the app is open.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (get().theme === 'system') {
      applyTheme('system');
      set({ isDark: resolve('system') });
    }
  });

  return {
    theme: initial,
    isDark: resolve(initial),

    setTheme(theme, persistToServer = true) {
      localStorage.setItem(STORAGE_KEY, theme);
      applyTheme(theme);
      set({ theme, isDark: resolve(theme) });
      if (persistToServer) {
        // Best effort: the local setting already took effect.
        api.put('/users/me/preferences', { theme }).catch(() => undefined);
      }
    },

    cycle() {
      const order: Theme[] = ['light', 'dark', 'system'];
      const next = order[(order.indexOf(get().theme) + 1) % order.length];
      get().setTheme(next);
    },
  };
});
