import { useEffect, useState } from 'react';
import { Appearance as SystemAppearance } from 'react-native';
import { applyPalette, DARK, LIGHT } from '../theme';
import { getItem, setItem } from './storage';

const AUTOPLAY_KEY = 'imadeo.autoplayVideos';
const APPEARANCE_KEY = 'imadeo.appearance';
const CELLULAR_KEY = 'imadeo.cellular';

/** What the user asked for, which is not the same as what is drawn. */
export type Appearance = 'system' | 'dark' | 'light';

let appearance: Appearance = 'system';
const appearanceListeners = new Set<(next: Appearance) => void>();

/** What `system` resolves to right now. */
const systemIsDark = () => SystemAppearance.getColorScheme() !== 'light';

export const resolvedDark = () => (appearance === 'system' ? systemIsDark() : appearance === 'dark');

/**
 * What UIKit has been told, so it is only ever told when it changes.
 *
 * `setColorScheme` announces itself through the same change listener this
 * module subscribes to, and that listener repaints while `system` is chosen —
 * so without this guard the two would call each other.
 */
let nativeStyle: 'light' | 'dark' | 'unspecified' | undefined;

/**
 * The platform's own chrome follows the setting too.
 *
 * The palette reaches what this app draws and stops there. The tab bar belongs
 * to `UITabBarController`, and it takes its material and its label colour from
 * the interface style — so a light palette under a dark UIKit is a translucent
 * dark bar and white labels over a white page, which reads as no bar at all.
 * `unspecified` gives the choice back to the system — and, unlike `null`, puts
 * the real system scheme back in the cache that `systemIsDark` reads.
 */
function paintNative() {
  const next = appearance === 'system' ? 'unspecified' : appearance;
  if (next === nativeStyle) return;
  nativeStyle = next;
  SystemAppearance.setColorScheme(next);
}

function paint() {
  paintNative();
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

/**
 * What may go up over mobile data, kept apart for photos and for videos.
 *
 * Both default to off, which is Wi-Fi only. A backup is not something anyone
 * asks for at the moment it happens — it runs on resume and in the background —
 * so the cost of getting this wrong lands on someone who never chose to pay it,
 * and the safe default is the one that cannot.
 *
 * Two settings rather than one because the sizes are not comparable. A day of
 * photographs is tens of megabytes and a single video can be more than all of
 * them; wanting the first on the move and not the second is the ordinary case,
 * and one switch cannot say it.
 */
let cellular = { photos: false, videos: false };
const cellularListeners = new Set<(next: { photos: boolean; videos: boolean }) => void>();

export function cellularAllowed(): { photos: boolean; videos: boolean } {
  return cellular;
}

export async function setCellularAllowed(next: { photos: boolean; videos: boolean }) {
  cellular = next;
  for (const listener of cellularListeners) listener(next);
  await setItem(CELLULAR_KEY, JSON.stringify(next));
}

/** Subscribes a screen to the setting, so the switches and a run never disagree. */
export function useCellularAllowed(): { photos: boolean; videos: boolean } {
  const [value, setValue] = useState(cellular);

  useEffect(() => {
    cellularListeners.add(setValue);
    return () => {
      cellularListeners.delete(setValue);
    };
  }, []);

  return value;
}

/** Reads the stored value once at start-up. */
export async function restorePreferences() {
  const [stored, mode, metered] = await Promise.all([
    getItem(AUTOPLAY_KEY),
    getItem(APPEARANCE_KEY),
    getItem(CELLULAR_KEY),
  ]);

  autoplay = stored !== 'off';
  for (const listener of listeners) listener(autoplay);

  if (metered) {
    try {
      const parsed = JSON.parse(metered) as Partial<typeof cellular>;
      cellular = { photos: parsed.photos === true, videos: parsed.videos === true };
      for (const listener of cellularListeners) listener(cellular);
    } catch {
      // Unreadable: leave both off, which is the safe answer anyway.
    }
  }

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
    return () => {
      listeners.delete(setOn);
    };
  }, []);

  return on;
}
