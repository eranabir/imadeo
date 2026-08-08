import { useEffect, useState } from 'react';
import { Appearance as SystemAppearance } from 'react-native';
import { applyPalette, DARK, LIGHT } from '../theme';
import { getItem, setItem } from './storage';

const AUTOPLAY_KEY = 'imadeo.autoplayVideos';
const APPEARANCE_KEY = 'imadeo.appearance';

/** What the user asked for, which is not the same as what is drawn. */
export type Appearance = 'system' | 'dark' | 'light';

let appearance: Appearance = 'system';
const appearanceListeners = new Set<(next: Appearance) => void>();

/** What `system` resolves to right now. */
const systemIsDark = () => SystemAppearance.getColorScheme() !== 'light';

export const resolvedDark = () => (appearance === 'system' ? systemIsDark() : appearance === 'dark');

function paint() {
  applyPalette(resolvedDark() ? DARK : LIGHT);
  for (const listener of appearanceListeners) listener(appearance);
}

export function currentAppearance(): Appearance {
  return appearance;
}

export async function setAppearance(next: Appearance) {
  appearance = next;
  paint();
  await setItem(APPEARANCE_KEY, next);
}

/**
 * The chosen appearance, and the repaint that follows it.
 *
 * The palette is a module-level object every screen already imports, so this
 * hook's job is only to swap its values and force the tree to render again —
 * which the root does by keying on what this returns.
 */
export function useAppearance(): Appearance {
  const [value, setValue] = useState(appearance);

  useEffect(() => {
    appearanceListeners.add(setValue);
    // Following the system means reacting when the system changes underneath.
    const subscription = SystemAppearance.addChangeListener(() => {
      if (appearance === 'system') paint();
    });
    return () => {
      appearanceListeners.delete(setValue);
      subscription.remove();
    };
  }, []);

  return value;
}

/**
 * Whether opening a video starts it.
 *
 * Kept in a module-level cache as well as on disk, because the viewer reads it
 * while a page is being swiped into view — an await there would mean the first
 * video decides whether to play a frame after it was already on screen.
 *
 * Defaults to on: tapping a video is asking to watch it, and the setting exists
 * for people on a metered connection, or who would rather a room stayed quiet.
 */
let autoplay = true;
const listeners = new Set<(next: boolean) => void>();

export function autoplayVideos(): boolean {
  return autoplay;
}

/** Reads the stored value once at start-up. */
export async function restorePreferences() {
  const [stored, mode] = await Promise.all([getItem(AUTOPLAY_KEY), getItem(APPEARANCE_KEY)]);

  autoplay = stored !== 'off';
  for (const listener of listeners) listener(autoplay);

  if (mode === 'dark' || mode === 'light' || mode === 'system') {
    appearance = mode;
  }
  paint();
}

export async function setAutoplayVideos(next: boolean) {
  autoplay = next;
  for (const listener of listeners) listener(next);
  await setItem(AUTOPLAY_KEY, next ? 'on' : 'off');
}

/** Subscribes a screen to the setting, so a switch and the viewer never disagree. */
export function useAutoplayVideos(): boolean {
  const [on, setOn] = useState(autoplay);

  useEffect(() => {
    listeners.add(setOn);
    void restorePreferences();
    return () => {
      listeners.delete(setOn);
    };
  }, []);

  return on;
}
