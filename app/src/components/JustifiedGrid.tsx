import clsx from 'clsx';
import { Heart, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mediaUrl } from '../lib/api';
import { startDrag } from '../lib/dnd';
import { formatDuration } from '../lib/format';
import type { Asset } from '../types';
import { SelectionCheck } from '../ui';
import { RetryingImage } from './RetryingImage';

interface Props {
  assets: Asset[];
  selected?: Set<string>;
  /** Preferred row height in px; rows flex around it to fill the width exactly. */
  targetRowHeight?: number;
  gap?: number;
  onOpen?: (asset: Asset) => void;
  onToggleSelect?: (asset: Asset) => void;
  /**
   * Shift-click. The page owns the range logic because it knows the full
   * ordered list — this grid may only be showing one day of it.
   */
  onSelectRange?: (asset: Asset) => void;
  /** Plain click, so the page can remember where a later Shift-click starts. */
  onAnchor?: (asset: Asset) => void;
  onContextMenu?: (asset: Asset, event: React.MouseEvent) => void;
}

interface Tile {
  asset: Asset;
  width: number;
  height: number;
}

/**
 * Finds the scroll container that owns this grid. Pages scroll inside Layout's
 * main element, not the browser window, so listening to `window` leaves the
 * virtual range frozen while the library moves.
 */
function scrollParent(element: HTMLElement) {
  let parent = element.parentElement;
  while (parent) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
    parent = parent.parentElement;
  }
  return null;
}

function firstAtOrAfter(offsets: number[], value: number) {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

const DEFAULT_RATIO = 3 / 2;

const ratioOf = (asset: Asset) => {
  const w = asset.exif?.exifImageWidth;
  const h = asset.exif?.exifImageHeight;
  if (!w || !h) return DEFAULT_RATIO;
  // Guard against absurd panoramas dominating a row.
  return Math.min(Math.max(w / h, 0.3), 4);
};

/**
 * Lays photos out in rows of equal height that fill the container exactly, the
 * way a contact sheet does — so nothing is cropped to a square and portrait and
 * landscape shots keep their real proportions.
 */
function buildRows(assets: Asset[], containerWidth: number, targetHeight: number, gap: number) {
  const rows: Tile[][] = [];
  let current: Asset[] = [];
  let ratioSum = 0;

  const flush = (isLast: boolean) => {
    if (current.length === 0) return;

    const totalGap = gap * (current.length - 1);
    const available = containerWidth - totalGap;
    // Scale the row so its combined width lands exactly on the container width.
    const fitted = available / ratioSum;

    // A trailing partial row is stretched too, but only up to a point: filling
    // the width with two photos is tidy, blowing one lonely photo up to full
    // bleed is not.
    const height = !isLast || fitted <= targetHeight * 1.6 ? fitted : targetHeight;

    rows.push(
      current.map((asset) => ({
        asset,
        width: ratioOf(asset) * height,
        height,
      })),
    );
    current = [];
    ratioSum = 0;
  };

  for (const asset of assets) {
    current.push(asset);
    ratioSum += ratioOf(asset);

    const projectedHeight = (containerWidth - gap * (current.length - 1)) / ratioSum;
    // Once fitting another photo would squash the row below the target, close it.
    if (projectedHeight < targetHeight) flush(false);
  }

  flush(true);

  return rows;
}

export function JustifiedGrid({
  assets,
  selected,
  targetRowHeight = 220,
  gap = 4,
  onOpen,
  onToggleSelect,
  onSelectRange,
  onAnchor,
  onContextMenu,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () => (width > 0 ? buildRows(assets, width, targetRowHeight, gap) : []),
    [assets, width, targetRowHeight, gap],
  );

  const rowOffsets = useMemo(() => {
    let offset = 0;
    return rows.map((row) => {
      const current = offset;
      offset += (row[0]?.height ?? 0) + gap;
      return current;
    });
  }, [rows, gap]);
  const totalHeight =
    rows.length === 0 ? 0 : (rowOffsets.at(-1) ?? 0) + (rows.at(-1)?.[0]?.height ?? 0);

  /*
   * A library can hold tens of thousands of photographs. Keep its geometry in
   * memory, but only mount the rows around the viewport (plus a generous
   * buffer for fast trackpad flings). This is deliberately local rather than a
   * second scroll box: pages retain their existing sticky headers and timeline
   * scrubber.
   */
  const [range, setRange] = useState({ start: 0, end: rows.length });
  useEffect(() => {
    const element = container.current;
    if (!element || rows.length === 0) return;
    const parent = scrollParent(element);

    const update = () => {
      const elementRect = element.getBoundingClientRect();
      const parentRect = parent?.getBoundingClientRect();
      const viewportTop = parent ? parent.scrollTop : window.scrollY;
      const viewportHeight = parent ? parent.clientHeight : window.innerHeight;
      const elementTop = parent
        ? parent.scrollTop + elementRect.top - (parentRect?.top ?? 0)
        : window.scrollY + elementRect.top;
      const localTop = Math.max(0, viewportTop - elementTop - viewportHeight * 1.5);
      const localBottom = viewportTop - elementTop + viewportHeight * 2.5;
      const start = Math.max(0, firstAtOrAfter(rowOffsets, localTop) - 1);
      const end = Math.min(rows.length, firstAtOrAfter(rowOffsets, localBottom) + 1);
      setRange((current) => (current.start === start && current.end === end ? current : { start, end }));
    };

    update();
    parent?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (parent) observer.observe(parent);
    return () => {
      parent?.removeEventListener('scroll', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [rows.length, rowOffsets, totalHeight]);

  const selecting = (selected?.size ?? 0) > 0;

  return (
    <div ref={container} className="relative w-full" style={{ height: totalHeight }}>
      {rows.slice(range.start, range.end).map((row, index) => {
        const rowIndex = range.start + index;
        return (
        <div
          key={rowIndex}
          className="absolute left-0 flex w-full"
          style={{ gap, top: rowOffsets[rowIndex] }}
        >
          {row.map(({ asset, width: w, height: h }) => {
            const isSelected = selected?.has(asset.id) ?? false;

            return (
              <div
                key={asset.id}
                className="group relative overflow-hidden bg-surface-sunken"
                style={{ width: w, height: h }}
                draggable
                onDragStart={(event) => {
                  // Dragging one of several selected photos moves the whole
                  // selection; dragging an unselected photo moves just it.
                  const ids =
                    isSelected && selected && selected.size > 0 ? [...selected] : [asset.id];
                  startDrag(
                    event,
                    { kind: 'assets', ids, label: asset.originalFileName },
                    { image: event.currentTarget.querySelector('img'), count: ids.length },
                  );
                }}
                onContextMenu={(event) => {
                  if (!onContextMenu) return;
                  // Replace the browser menu with the app's own.
                  event.preventDefault();
                  onContextMenu(asset, event);
                }}
              >
                <RetryingImage
                  src={mediaUrl(asset.id, 'thumbnail')}
                  alt={asset.originalFileName}
                  loading="lazy"
                  decoding="async"
                  // Images are natively draggable. Left on, the browser drags
                  // the picture itself and the tile's own dragstart never runs.
                  draggable={false}
                  onClick={(event) => {
                    // Ctrl/Cmd-click starts or extends a selection and
                    // Shift-click takes the run up to it. Without these a
                    // selection could only be built one hover-tick at a time.
                    if (event.shiftKey && onSelectRange) {
                      event.preventDefault();
                      onSelectRange(asset);
                      return;
                    }

                    if (event.metaKey || event.ctrlKey || selecting) {
                      event.preventDefault();
                      onToggleSelect?.(asset);
                      return;
                    }

                    onAnchor?.(asset);
                    onOpen?.(asset);
                  }}
                  className={clsx(
                    'h-full w-full cursor-pointer object-cover transition duration-200',
                    isSelected ? 'scale-[0.92]' : 'group-hover:brightness-110',
                  )}
                />

                {/* Top gradient carries the selection control without a border.
                    Only where a control is actually showing: keying it off
                    `selecting` darkened the top of every photo in the library
                    the moment one was picked, which read as a shadow cast over
                    the untouched ones. */}
                <div
                  className={clsx(
                    'pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/45 to-transparent transition-opacity',
                    isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                />

                <SelectionCheck
                  tone="media"
                  checked={isSelected}
                  onChange={() => onToggleSelect?.(asset)}
                  label={isSelected ? 'Deselect' : 'Select'}
                  className={clsx(
                    'absolute left-2 top-2',
                    !isSelected && 'opacity-0 group-hover:opacity-100',
                  )}
                />

                {asset.type === 'VIDEO' && (
                  <span className="pointer-events-none absolute bottom-1.5 right-2 flex items-center gap-1 text-[11px] font-medium text-white drop-shadow-md">
                    <Play size={11} fill="currentColor" />
                    {formatDuration(asset.duration)}
                  </span>
                )}

                {asset.isFavorite && (
                  <Heart
                    size={15}
                    className="pointer-events-none absolute bottom-1.5 left-2 text-white drop-shadow-md"
                    fill="currentColor"
                  />
                )}
              </div>
            );
          })}
        </div>
        );
      })}
    </div>
  );
}
