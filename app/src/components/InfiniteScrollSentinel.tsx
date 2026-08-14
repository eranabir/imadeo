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

    // Virtual grids measure their height after the first paint. Observing the
    // footer before that measurement briefly puts it at the top and fetches a
    // second page immediately, even though nobody has scrolled. Wait for the
    // measured layout so pagination stays tied to approaching the real end.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => observer.observe(node));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      observer.disconnect();
    };
  }, [enabled, loading, onVisible]);

  if (!enabled && !loading) return null;
  return (
    <div
      ref={element}
      aria-label="Load more items"
      className="py-6 text-center text-xs text-content-muted"
    >
      {loading ? 'Loading more photos…' : ''}
    </div>
  );
}
