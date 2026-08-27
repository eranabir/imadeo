import { useCallback, useEffect, useState } from 'react';
import { getItem, setItem } from './storage';

export type MediaViewMode = 'grid' | 'list';

const VIEW_MODE_KEY = 'imadeo.mediaViewMode';

let current: MediaViewMode = 'grid';
let restored = false;
let restoring: Promise<void> | null = null;
let revision = 0;
const listeners = new Set<(mode: MediaViewMode) => void>();

function announce(mode: MediaViewMode) {
  current = mode;
  for (const listener of listeners) listener(mode);
}

async function restore() {
  if (restored) return;
  const startedAt = revision;
  restoring ??= getItem(VIEW_MODE_KEY)
    .then((stored) => {
      if (revision === startedAt && (stored === 'grid' || stored === 'list')) announce(stored);
      restored = true;
    })
    .finally(() => {
      restoring = null;
    });
  return restoring;
}

/** One remembered choice shared by folder and album contents. */
export function useMediaViewMode() {
  const [mode, setMode] = useState(current);

  useEffect(() => {
    listeners.add(setMode);
    void restore();
    return () => {
      listeners.delete(setMode);
    };
  }, []);

  const choose = useCallback((next: MediaViewMode) => {
    revision += 1;
    restored = true;
    announce(next);
    void setItem(VIEW_MODE_KEY, next);
  }, []);

  return [mode, choose] as const;
}
