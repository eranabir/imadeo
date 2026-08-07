import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

export interface ScrubberSection {
  /** Matches the `data-section` attribute on the rendered group. */
  id: string;
  label: string;
  count: number;
}

interface Props {
  sections: ScrubberSection[];
}

/** Room left above a jumped-to date so it does not sit under the page header. */
const HEADER_CLEARANCE = 64;

/** Nearest ancestor that actually scrolls — the page shell, in practice. */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current) {
    const overflow = getComputedStyle(current).overflowY;
    /**
     * Deliberately does not require the element to be overflowing yet. This
     * runs before the photos have loaded, so at that moment nothing overflows —
     * requiring it meant the container resolved to null, and since the effect
     * never re-ran, every date click silently did nothing.
     */
    if (overflow === 'auto' || overflow === 'scroll') return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * A date rail down the right edge, like the scrubber in a phone gallery.
 *
 * Positions are proportional to each section's offset in the scroll container
 * rather than evenly spaced, so the marker under the cursor is the date you
 * will actually land on. Labels are thinned out when they would collide,
 * because a rail of overlapping months is unreadable and unclickable.
 */
export function TimelineScrubber({ sections }: Props) {
  const rail = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [active, setActive] = useState(0);
  const [hovering, setHovering] = useState(false);

  // Resolved from the DOM so a page only has to render the rail; it does not
  // need to know which ancestor happens to be the scroll container.
  useEffect(() => {
    setContainer(findScrollParent(rail.current));
  }, [sections.length]);

  /**
   * Where each section sits as a fraction of the *content* height — not of the
   * scrollable distance. Those two differ by a whole viewport, and dividing by
   * the smaller one made every date past the first screenful clamp to 1.0: nine
   * dates collapsed onto six overlapping markers pinned to the bottom of the
   * rail, so clicking them all landed in the same place and looked like a rail
   * that did nothing.
   */
  useEffect(() => {
    if (!container || sections.length === 0) return;

    const measure = () => {
      const total = container.scrollHeight;
      if (total <= 0) {
        setOffsets(sections.map((_, index) => index / Math.max(1, sections.length - 1)));
        return;
      }

      setOffsets(
        sections.map((section) => {
          const element = container.querySelector<HTMLElement>(`[data-section="${section.id}"]`);
          if (!element) return 0;
          const top = element.offsetTop - (container as HTMLElement).offsetTop;
          return Math.min(1, Math.max(0, top / total));
        }),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [sections, container]);

  // Keep the highlighted date in step with the scroll position.
  useEffect(() => {
    if (!container) return;

    const onScroll = () => {
      // Same basis as the marker offsets above, or the highlight drifts out of
      // step with them. Compared against the top of the viewport, since that is
      // where a heading comes to rest after a jump.
      const total = container.scrollHeight;
      const progress = total > 0 ? container.scrollTop / total : 0;

      let index = 0;
      for (let i = 0; i < offsets.length; i++) {
        if (offsets[i] <= progress + 0.001) index = i;
      }
      setActive(index);
    };

    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [offsets, container]);

  /**
   * Scrolls the container directly rather than calling `scrollIntoView`.
   *
   * That method targets the nearest scrollport, which here resolved to the page
   * rather than the media pane, so clicking a date did nothing at all. Measuring
   * the offset ourselves also lets the target clear the sticky header instead of
   * hiding underneath it.
   */
  const jump = (index: number) => {
    const section = sections[index];
    if (!container || !section) return;

    const element = container.querySelector<HTMLElement>(`[data-section="${section.id}"]`);
    if (!element) return;

    const top =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      HEADER_CLEARANCE;

    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  if (sections.length < 2) return null;

  /**
   * One marker per year, not per day.
   *
   * A full date is far wider than the rail, so the label spilled leftward across
   * the photos — the rail looked like it was printing on top of the grid. A year
   * fits inside the rail's own width, so nothing escapes it. Each year points at
   * the first section belonging to it, which is where a jump should land.
   */
  const years: { year: string; index: number; count: number }[] = [];
  sections.forEach((section, index) => {
    const year = section.id.slice(0, 4);
    const existing = years.find((entry) => entry.year === year);
    if (existing) existing.count += section.count;
    else years.push({ year, index, count: section.count });
  });

  const activeYear = sections[active]?.id.slice(0, 4);

  return (
    <div
      ref={rail}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      // Fixed width with the labels clipped to it, so a marker can never reach
      // out over the grid no matter how the content below changes.
      className="pointer-events-auto sticky top-0 z-20 hidden h-[calc(100vh-4rem)] w-14 shrink-0 select-none overflow-hidden lg:block"
    >
      <div className="relative h-full">
        {years.map(({ year, index, count }) => {
          const isActive = year === activeYear;

          return (
            <button
              key={year}
              type="button"
              onClick={() => jump(index)}
              aria-label={`Jump to ${year} — ${count} ${count === 1 ? 'item' : 'items'}`}
              style={{ top: `${(offsets[index] ?? 0) * 100}%` }}
              className={clsx(
                'absolute right-2 flex -translate-y-1/2 items-center gap-1.5 rounded-full py-0.5 pl-2 pr-1 text-[10px] tabular-nums transition',
                isActive ? 'font-semibold text-primary' : 'text-content-muted hover:text-content',
              )}
            >
              <span
                className={clsx(
                  'whitespace-nowrap transition-opacity',
                  isActive || hovering ? 'opacity-100' : 'opacity-70',
                )}
              >
                {year}
              </span>
              <span
                className={clsx(
                  'block h-px rounded-full transition-all',
                  isActive ? 'w-3 bg-primary' : 'w-1.5 bg-border-strong',
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
