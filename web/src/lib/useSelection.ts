import { useCallback, useRef, useState } from 'react';

interface Identified {
  id: string;
}

/**
 * Selection state for a grid of assets.
 *
 * The Shift-click anchor lives here rather than in the grid because a page like
 * Photos renders one grid per day: an anchor held by the grid would reset at
 * every day boundary, so a range could never span two days. Keeping it at the
 * page level lets `selectRange` measure against the whole ordered list.
 */
export function useSelection<T extends Identified>() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** The last item clicked without Shift — where the next range starts. */
  const anchor = useRef<string | null>(null);

  const toggle = useCallback((item: T) => {
    anchor.current = item.id;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const selectMany = useCallback((items: T[]) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of items) next.add(item.id);
      return next;
    });
  }, []);

  /**
   * Adds everything between the anchor and `item` in `order`. With no anchor
   * yet — Shift-click as the very first action — this selects just the one
   * item, which is also what it becomes the anchor for.
   */
  const selectRange = useCallback((item: T, order: T[]) => {
    const to = order.findIndex((entry) => entry.id === item.id);
    if (to === -1) return;

    const from = anchor.current
      ? order.findIndex((entry) => entry.id === anchor.current)
      : -1;

    if (from === -1) {
      anchor.current = item.id;
      setSelected((current) => new Set(current).add(item.id));
      return;
    }

    const [start, end] = from < to ? [from, to] : [to, from];
    setSelected((current) => {
      const next = new Set(current);
      for (const entry of order.slice(start, end + 1)) next.add(entry.id);
      return next;
    });
  }, []);

  /** Records where a plain click landed, so a following Shift-click has a start. */
  const setAnchor = useCallback((item: T) => {
    anchor.current = item.id;
  }, []);

  const clear = useCallback(() => {
    anchor.current = null;
    setSelected(new Set());
  }, []);

  return { selected, toggle, selectMany, selectRange, setAnchor, clear, setSelected };
}
