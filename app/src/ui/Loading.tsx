import clsx from 'clsx';
import type { CSSProperties } from 'react';
import { Logo } from '../components/Logo';

const openingPieces = [
  { left: 0, top: 0, x: -18, y: -18, delay: 0 },
  { left: 64, top: 0, x: 18, y: -18, delay: 70 },
  { left: 0, top: 64, x: -18, y: 18, delay: 140 },
  { left: 64, top: 64, x: 18, y: 18, delay: 210 },
];

/** The same four-piece mark assembly used while the native app opens. */
export function Opening() {
  return (
    <div
      role="status"
      aria-label="Opening Imadeo"
      className="grid h-full min-h-dvh place-items-center bg-surface"
    >
      <div className="imadeo-opening-breathe">
        <div className="imadeo-opening-turn relative h-32 w-32">
          {openingPieces.map((piece) => (
            <span
              key={`${piece.left}-${piece.top}`}
              className="absolute h-16 w-16 overflow-hidden"
              style={{ left: piece.left, top: piece.top }}
            >
              <span
                className="imadeo-opening-piece absolute block"
                style={
                  {
                    left: piece.left,
                    top: piece.top,
                    '--opening-x': `${piece.x}px`,
                    '--opening-y': `${piece.y}px`,
                    '--opening-delay': `${piece.delay}ms`,
                  } as CSSProperties
                }
              >
                <Logo size={128} />
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The app's loading state.
 *
 * A few blank frames settling into place — the shape of what is arriving,
 * rather than a row of icons announcing the *idea* of photos. Waiting should
 * feel like the page is already forming, not like a separate screen has
 * interrupted it, so this is deliberately quiet: no spinner, no bouncing, one
 * slow shimmer across placeholder tiles.
 */
export function Loading({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  // Uneven, so it reads as photographs rather than a grid of buttons.
  const tiles = [
    { w: 84, h: 56 },
    { w: 64, h: 56 },
    { w: 96, h: 56 },
  ];

  return (
    <div
      role="status"
      aria-live="polite"
      // content-center as well as place-items-center: when a caller gives this a
      // full-height parent the implicit rows would otherwise stretch to fill it,
      // stranding the tiles and the label at opposite ends instead of grouping
      // them by the gap.
      className={clsx('grid content-center place-items-center gap-5 py-24', className)}
    >
      <div className="flex items-end gap-2">
        {tiles.map((tile, index) => (
          <span
            key={index}
            className="block overflow-hidden rounded-lg bg-surface-sunken"
            style={{
              width: tile.w,
              height: tile.h,
              animation: 'imadeo-shimmer 1.8s ease-in-out infinite',
              animationDelay: `${index * 0.18}s`,
            }}
          />
        ))}
      </div>

      <p className="text-sm text-content-muted">{label}</p>
    </div>
  );
}

/** Placeholder tiles that mirror the justified grid while photos load. */
export function GridSkeleton({ rows = 3 }: { rows?: number }) {
  // Uneven widths so it reads as photos of different shapes, not a table.
  const widths = [
    [32, 22, 26, 20],
    [24, 30, 18, 28],
    [20, 26, 34, 20],
  ];

  return (
    <div className="space-y-1 px-2" role="status" aria-label="Loading photos">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-1">
          {widths[row % widths.length].map((width, column) => (
            <span
              key={column}
              className="h-[180px] rounded-md bg-surface-sunken"
              style={{
                width: `${width}%`,
                animation: 'imadeo-pulse 1.6s ease-in-out infinite',
                animationDelay: `${(row * 4 + column) * 0.08}s`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
