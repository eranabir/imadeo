import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ScrubberSection {
  /** Matches, or prefixes, the `data-section` attribute on the rendered group. */
  id: string;
  label: string;
  count: number;
  /** Stable fallback while the corresponding photos have not been downloaded. */
  position?: number;
}

interface Props {
  sections: ScrubberSection[];
  onLoadSection?: (id: string) => Promise<void>;
  /** Changes whenever newly downloaded content adds section elements. */
  contentVersion?: number;
}

/** Room left above a jumped-to date so it does not sit under the page header. */
const HEADER_CLEARANCE = 64;

/** Keep every year legible while retaining its proportional place on the rail. */
const MARKER_EDGE_CLEARANCE = 10;
const MARKER_SPACING = 24;

function spreadMarkers(raw: number[], railHeight: number) {
  if (raw.length === 0 || railHeight <= 0) return raw;

  const min = MARKER_EDGE_CLEARANCE;
  const max = Math.max(min, railHeight - MARKER_EDGE_CLEARANCE);
  const spacing = Math.min(MARKER_SPACING, (max - min) / Math.max(1, raw.length - 1));
  const positions = raw.map((position) => Math.min(max, Math.max(min, position)));

  for (let index = 1; index < positions.length; index++) {
    positions[index] = Math.max(positions[index], positions[index - 1] + spacing);
  }

  if (positions.at(-1)! > max) {
    positions[positions.length - 1] = max;
    for (let index = positions.length - 2; index >= 0; index--) {
      positions[index] = Math.min(positions[index], positions[index + 1] - spacing);
    }
  }

  return positions;
}

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

function findSection(container: HTMLElement, id: string) {
  const escaped = CSS.escape(id);
  return (
    container.querySelector<HTMLElement>(`[data-section="${escaped}"]`) ??
    container.querySelector<HTMLElement>(`[data-section^="${escaped}"]`)
  );
}

/**
 * A date rail down the right edge, like the scrubber in a phone gallery.
 *
 * Positions are proportional to each section's offset in the scroll container
 * rather than evenly spaced, so the marker under the cursor is the date you
 * will actually land on. Labels are thinned out when they would collide,
 * because a rail of overlapping months is unreadable and unclickable.
 */
export function TimelineScrubber({ sections, onLoadSection, contentVersion }: Props) {
  const rail = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [railHeight, setRailHeight] = useState(0);
  const [sectionTops, setSectionTops] = useState<number[]>([]);
  const [active, setActive] = useState(0);
  const [hovering, setHovering] = useState(false);

  // Resolved from the DOM so a page only has to render the rail; it does not
  // need to know which ancestor happens to be the scroll container.
  useEffect(() => {
    setContainer(findScrollParent(rail.current));
  }, [sections.length]);

  /**
   * Keep section positions in the scroll container's coordinate system. Using
   * `offsetTop` here mixed two different offset parents, so the highlighted
   * year drifted from the date actually pinned below the header.
   */
  useEffect(() => {
    if (!container || sections.length === 0) return;

    const measure = () => {
      setRailHeight(rail.current?.clientHeight ?? 0);
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (maxScroll <= 0) {
        const fallback = sections.map(
          (section, index) => section.position ?? index / Math.max(1, sections.length - 1),
        );
        setSectionTops(sections.map(() => Number.POSITIVE_INFINITY));
        setOffsets(fallback);
        return;
      }

      const containerTop = container.getBoundingClientRect().top;
      const tops = sections.map((section) => {
        const element = findSection(container, section.id);
        if (!element) return Number.POSITIVE_INFINITY;
        return element.getBoundingClientRect().top - containerTop + container.scrollTop;
      });

      setSectionTops(tops);
      // The rail is a miniature of the full page, not the scrollbar thumb.
      // Its markers therefore use content height, while active state below
      // still uses the sticky heading line where a date becomes visible.
      setOffsets(
        tops.map((top, index) =>
          Number.isFinite(top)
            ? Math.min(1, Math.max(0, top / container.scrollHeight))
            : (sections[index].position ?? index / Math.max(1, sections.length - 1)),
        ),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (rail.current) observer.observe(rail.current);
    sections.forEach((section) => {
      const element = findSection(container, section.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [sections, container, contentVersion]);

  // Keep the highlighted date in step with the section that has reached the
  // sticky heading line, rather than approximating it from page progress.
  useEffect(() => {
    if (!container) return;

    const onScroll = () => {
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (
        container.scrollTop >= maxScroll - 1 &&
        sections.at(-1) &&
        findSection(container, sections.at(-1)!.id)
      ) {
        setActive(Math.max(0, sections.length - 1));
        return;
      }

      const activationLine = container.scrollTop + HEADER_CLEARANCE + 1;
      let index = 0;
      for (let i = 0; i < sectionTops.length; i++) {
        if (sectionTops[i] <= activationLine) index = i;
      }
      setActive(index);
    };

    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [sectionTops, sections.length, container]);

  /**
   * Scrolls the container directly rather than calling `scrollIntoView`.
   *
   * That method targets the nearest scrollport, which here resolved to the page
   * rather than the media pane, so clicking a date did nothing at all. Measuring
   * the offset ourselves also lets the target clear the sticky header instead of
   * hiding underneath it.
   */
  const jump = async (index: number) => {
    const section = sections[index];
    if (!container || !section) return;

    let element = findSection(container, section.id);
    if (!element && onLoadSection) {
      await onLoadSection(section.id);

      // React still needs a paint after the query resolves before the new day
      // group exists in the DOM.
      for (let frame = 0; frame < 20 && !element; frame++) {
        await new Promise(requestAnimationFrame);
        element = findSection(container, section.id);
      }
    }
    if (!element) return;

    setActive(index);

    const top =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      HEADER_CLEARANCE;

    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  /**
   * One marker per year, not per day.
   *
   * A full date is far wider than the rail, so the label spilled leftward across
   * the photos — the rail looked like it was printing on top of the grid. A year
   * fits inside the rail's own width, so nothing escapes it. Each year points at
   * the first section belonging to it, which is where a jump should land.
   */
  const years = useMemo(() => {
    const entries: { year: string; index: number; count: number }[] = [];
    sections.forEach((section, index) => {
      const year = section.id.slice(0, 4);
      const existing = entries.find((entry) => entry.year === year);
      if (existing) existing.count += section.count;
      else entries.push({ year, index, count: section.count });
    });
    return entries;
  }, [sections]);

  const markerPositions = useMemo(
    () => spreadMarkers(years.map(({ index }) => (offsets[index] ?? 0) * railHeight), railHeight),
    [years, offsets, railHeight],
  );

  if (sections.length < 2) return null;

  const activeYear = sections[active]?.id.slice(0, 4);

  return (
    <div
      ref={rail}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      // Fixed width with the labels clipped to it, so a marker can never reach
      // out over the grid no matter how the content below changes.
      className="pointer-events-auto sticky top-16 z-20 hidden h-[calc(100vh-8rem)] w-14 shrink-0 select-none overflow-hidden lg:block"
    >
      <div className="relative h-full">
        {years.map(({ year, index, count }, markerIndex) => {
          const isActive = year === activeYear;

          return (
            <button
              key={year}
              type="button"
              onClick={() => void jump(index)}
              aria-label={`Jump to ${year} — ${count} ${count === 1 ? 'item' : 'items'}`}
              style={{ top: markerPositions[markerIndex] ?? MARKER_EDGE_CLEARANCE }}
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
