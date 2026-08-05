import clsx from 'clsx';
import { Heart, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mediaUrl } from '../lib/api';
import { startDrag } from '../lib/dnd';
import { formatDuration } from '../lib/format';
import type { Asset } from '../types';
import { SelectionCheck } from '../ui';

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

  const selecting = (selected?.size ?? 0) > 0;

  return (
    <div ref={container} className="w-full">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex" style={{ gap, marginBottom: gap }}>
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
                <img
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

                {/* Top gradient carries the selection control without a border. */}
                <div
                  className={clsx(
                    'pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/45 to-transparent transition-opacity',
                    isSelected || selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
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
      ))}
    </div>
  );
}
