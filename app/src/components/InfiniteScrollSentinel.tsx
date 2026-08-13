import { useEffect, useRef } from 'react';

/** Fetches the next API page when the end of a virtual grid nears the viewport. */
export function InfiniteScrollSentinel({
  enabled,
  loading,
  onVisible,
}: {
  enabled: boolean;
  loading: boolean;
  onVisible: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = element.current;
    if (!node || !enabled || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onVisible();
      },
      // Begin before the user reaches the last visible row, so a fast scroll
      // never lands on an artificial empty gap.
      { rootMargin: '900px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, loading, onVisible]);

  if (!enabled && !loading) return null;
  return (
    <div ref={element} className="py-6 text-center text-xs text-content-muted">
      {loading ? 'Loading more photos…' : ''}
    </div>
  );
}
