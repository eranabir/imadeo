import { useEffect, useMemo, useReducer } from 'react';
import { PageWindow, type IndexedCollection, type IndexPage } from './indexedCollection';

export function usePageWindow<T extends { id: string }>(key: string,
  fetchPage: (page: number, signal: AbortSignal) => Promise<IndexPage<T>>, enabled = true, size = 60) {
  const cache = useMemo(() => new PageWindow(fetchPage, size), [key, fetchPage, size]);
  const [, update] = useReducer(value => value + 1, 0);
  useEffect(() => {
    const unsubscribe = cache.subscribe(update);
    if (enabled) void cache.reload();
    return () => { unsubscribe(); cache.dispose(); };
  }, [cache, enabled]);
  const collection = useMemo<IndexedCollection<T>>(() => ({
    key, total: cache.total ?? 0, version: cache.version,
    itemAt: cache.itemAt, loadRange: cache.loadRange, retain: cache.retain,
  }), [cache, key, cache.version]);
  const items = useMemo(() => cache.items, [cache, cache.version]);
  return { collection, items, error: cache.error,
    loading: enabled && cache.total === null && !cache.error,
    loadingMore: cache.total !== null && cache.pending.size > 0,
    pagination: cache.total === null ? null : { page: 1, size, total: cache.total, pages: Math.ceil(cache.total / size) },
    reload: cache.reload,
    // Compatibility for screens; indexed lists request their visible range.
    hasMore: false, loadMore: () => undefined,
  };
}
