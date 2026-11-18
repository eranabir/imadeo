import { useCallback, useEffect, useRef, useState } from 'react';

/** Keep a seek's logical position while additional metadata pages arrive. */
export function usePaginatedSeek({ contentHeight, loadedHeight, viewportHeight, loadedCount,
  hasMore, loadingMore, onLoadMore, scrollTo }: {
  contentHeight: number;
  loadedHeight: number;
  viewportHeight: number;
  loadedCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore?: () => void;
  scrollTo: (offset: number) => void;
}) {
  const fraction = useRef<number | null>(null);
  const requestedAt = useRef<number | null>(null);
  const [, redraw] = useState(0);
  const latest = useRef({ contentHeight, loadedHeight, viewportHeight, loadedCount,
    hasMore, loadingMore, onLoadMore, scrollTo });
  latest.current = { contentHeight, loadedHeight, viewportHeight, loadedCount,
    hasMore, loadingMore, onLoadMore, scrollTo };

  const apply = useCallback(() => {
    const state = latest.current;
    if (fraction.current === null) return;
    if (state.loadedCount === 0) { fraction.current = null; return; }
    const target = fraction.current * Math.max(0, state.contentHeight - state.viewportHeight);
    const available = Math.max(0, state.loadedHeight - state.viewportHeight);
    state.scrollTo(Math.min(target, available));
    if (state.hasMore && target > available + 1 && !state.loadingMore &&
        requestedAt.current !== state.loadedCount && state.onLoadMore) {
      // A failed request must not loop forever. A new drag can retry it.
      requestedAt.current = state.loadedCount;
      state.onLoadMore();
    }
    // Retain intent until a normal list drag cancels it: native layout can
    // arrive after the final metadata page, even after the finger is released.
  }, []);

  const seek = useCallback((offset: number) => {
    fraction.current = Math.min(1, Math.max(0,
      offset / Math.max(1, latest.current.contentHeight - latest.current.viewportHeight)));
    // Moving the handle must not rerender every photo on every gesture frame.
    apply();
  }, [apply]);
  const cancel = useCallback(() => {
    if (fraction.current !== null) { fraction.current = null; redraw(value => value + 1); }
    requestedAt.current = null;
  }, []);
  const begin = useCallback(() => { requestedAt.current = null; }, []);

  useEffect(apply, [apply, contentHeight, loadedHeight, viewportHeight, loadedCount,
    hasMore, loadingMore, onLoadMore, scrollTo]);
  return { seek, cancel, begin, get fraction() { return fraction.current; } };
}

/** Estimate unloaded rows without multiplying the header or bottom clearance. */
export function fullScrollHeight(loadedHeight: number, loadedCount: number,
  totalCount: number, columns: number, rowHeight: number) {
  return loadedHeight + Math.max(0, Math.ceil(totalCount / columns) - Math.ceil(loadedCount / columns)) * rowHeight;
}
