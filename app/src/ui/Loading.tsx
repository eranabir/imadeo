import clsx from 'clsx';

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
      className={clsx('grid place-items-center gap-5 py-24', className)}
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
