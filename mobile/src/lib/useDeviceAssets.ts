import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { request, usePagedResource, useToken, type Asset, type Paged } from './api';
import { readDeviceAssetIndex, sortDeviceAssets } from './deviceSort';

/** Uses API pagination for Date/Name and a complete metadata index for Type. */
export function useDeviceAssets(serverUrl: string, deviceId: string, sort: 'date' | 'name' | 'type', order: 'asc' | 'desc') {
  const base = `/assets?deviceId=${encodeURIComponent(deviceId)}`;
  const paged = usePagedResource<Asset>(serverUrl, sort === 'type' ? null : `${base}&sortBy=${sort}&order=${order}`);
  const token = useToken();
  const [index, setIndex] = useState<{ deviceId: string; items: Asset[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const enabled = sort === 'type';
  const reload = useCallback(async (silent = false) => {
    if (!enabled) return;
    const mine = ++generation.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const items = await readDeviceAssetIndex<Asset>(page =>
        // Date ordering has the server's ID tie-breaker; duplicate filenames
        // must not shuffle between metadata pages before client-side grouping.
        request<Paged<Asset>>(serverUrl, `${base}&sortBy=date&order=asc&page=${page}&size=1000`),
        () => mine === generation.current);
      if (items && mine === generation.current) setIndex({ deviceId, items });
    } catch (cause) {
      if (mine === generation.current) setError(cause instanceof Error ? cause.message : 'Could not load this device library.');
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [base, deviceId, enabled, serverUrl]);
  useEffect(() => {
    if (enabled) void reload();
    else setLoading(false);
    return () => { generation.current++; };
  }, [enabled, reload]);
  const focused = useRef(false);
  const focusRequest = useRef({ enabled, reload });
  focusRequest.current = { enabled, reload };
  useFocusEffect(useCallback(() => {
    if (focused.current && focusRequest.current.enabled) void focusRequest.current.reload();
    focused.current = true;
    return () => {
      generation.current++;
      setLoading(false);
    };
  }, []));
  const items = useMemo(() => sortDeviceAssets(index?.deviceId === deviceId ? index.items : [], order), [index, deviceId, order]);
  if (!enabled) return paged;
  return { items, token, loading: loading || (!error && index?.deviceId !== deviceId), error, reload,
    pagination: index?.deviceId === deviceId ? { page: 1, size: items.length, total: items.length } : null,
    hasMore: false, loadingMore: false, loadMore: () => undefined };
}
