import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';

interface ThumbnailStatusResponse {
  readyIds: string[];
}

interface ThumbnailReadinessValue {
  active: boolean;
  isReady: (assetId: string) => boolean;
  watch: (assetId: string) => () => void;
}

const ThumbnailReadinessContext = createContext<ThumbnailReadinessValue>({
  active: false,
  isReady: () => false,
  watch: () => () => undefined,
});

const POLL_INTERVAL_MS = 3_000;
const STATUS_BATCH_SIZE = 2_000;

/**
 * Replaces one retry timer per media tile with one readiness request for every
 * pending thumbnail currently mounted by the virtual grids.
 */
export function ThumbnailReadinessProvider({ children }: { children: React.ReactNode }) {
  const watched = useRef(new Map<string, number>());
  const readyRef = useRef(new Set<string>());
  const [readyIds, setReadyIds] = useState<Set<string>>(() => new Set());
  const [watchRevision, setWatchRevision] = useState(0);

  const watch = useCallback((assetId: string) => {
    const count = watched.current.get(assetId) ?? 0;
    watched.current.set(assetId, count + 1);
    if (count === 0 && !readyRef.current.has(assetId)) {
      setWatchRevision((revision) => revision + 1);
    }

    return () => {
      const current = watched.current.get(assetId) ?? 0;
      if (current <= 1) watched.current.delete(assetId);
      else watched.current.set(assetId, current - 1);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const pending = [...watched.current.keys()]
        .filter((id) => !readyRef.current.has(id))
        .slice(0, STATUS_BATCH_SIZE);
      if (pending.length === 0 || stopped) return;

      try {
        const { data } = await api.post<ThumbnailStatusResponse>('/assets/thumbnail-status', {
          ids: pending,
        });
        if (data.readyIds.length > 0 && !stopped) {
          const next = new Set(readyRef.current);
          for (const id of data.readyIds) next.add(id);
          readyRef.current = next;
          setReadyIds(next);
        }
      } catch {
        // Keep the placeholders visible and retry the single batched request.
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [watchRevision]);

  const value = useMemo<ThumbnailReadinessValue>(
    () => ({
      active: true,
      isReady: (assetId) => readyIds.has(assetId),
      watch,
    }),
    [readyIds, watch],
  );

  return (
    <ThumbnailReadinessContext.Provider value={value}>
      {children}
    </ThumbnailReadinessContext.Provider>
  );
}

export const useThumbnailReadiness = () => useContext(ThumbnailReadinessContext);
