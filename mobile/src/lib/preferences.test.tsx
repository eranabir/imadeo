import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ scheme: 'dark', changed: undefined as undefined | (() => void) }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Appearance: {
    getColorScheme: () => native.scheme,
    setColorScheme: vi.fn(),
    addChangeListener: (changed: () => void) => { native.changed = changed; return { remove() {} }; },
  },
}));
vi.mock('./storage', () => ({ getItem: async () => null, setItem: vi.fn() }));
import { restorePreferences, useAppearance } from './preferences';
import { colors, DARK, LIGHT } from '../theme';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('repaints navigation when system colors resolve without changing the appearance preference', async () => {
  let tree!: ReactTestRenderer;
  const frames: string[] = [];
  function NavigationTheme() {
    const preference = useAppearance();
    frames.push(colors.bg);
    return React.createElement('Theme', { preference, background: colors.bg });
  }
  await act(async () => { tree = create(<NavigationTheme />); });
  expect(frames.at(-1)).toBe(DARK.bg);
  native.scheme = 'light';
  await act(async () => { await restorePreferences(); });
  expect(tree.root.findByType('Theme' as any).props).toMatchObject({ preference: 'system', background: LIGHT.bg });
  native.scheme = 'dark';
  await act(async () => { native.changed?.(); });
  expect(frames.at(-1)).toBe(DARK.bg);
  await act(async () => tree.unmount());
});
