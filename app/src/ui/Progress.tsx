import clsx from 'clsx';

interface Props {
  /** How far along, 0 to 1. Omit for work whose length is not known. */
  value?: number;
  /** Read out to screen readers in place of the bare number. */
  label: string;
  className?: string;
}

/**
 * How far something has got.
 *
 * Two shapes, because there are two honest answers. With a `value` it fills;
 * without one it sweeps, which says "still working" without inventing a
 * fraction — a bar that sits at 90% because nobody knew the total is worse than
 * no bar at all.
 *
 * The track is `border-subtle` and the fill runs secondary to primary-deep, the
 * same ramp as the storage card, so every gauge in the app reads as one control.
 */
export function Progress({ value, label, className }: Props) {
  const known = typeof value === 'number';
  const percent = known ? Math.min(100, Math.max(0, value * 100)) : undefined;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(percent!) : undefined}
      className={clsx('h-1.5 overflow-hidden rounded-full bg-border-subtle', className)}
    >
      {known ? (
        <div
          className="h-full rounded-full bg-gradient-to-r from-secondary to-primary-deep transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      ) : (
        <div className="h-full w-2/5 animate-[imadeo-sweep_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-secondary to-primary-deep" />
      )}
    </div>
  );
}
