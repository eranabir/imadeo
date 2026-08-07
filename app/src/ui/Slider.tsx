import clsx from 'clsx';

/**
 * A range control that follows the design tokens.
 *
 * The native slider is painted by the OS: it ignores the primary colour, differs
 * between browsers, and looks foreign next to the rest of the system. The input
 * stays underneath for keyboard and assistive support; only the appearance is
 * replaced.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  'aria-label': ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <span className={clsx('relative flex h-5 items-center', className)}>
      <span className="absolute inset-x-0 h-1.5 rounded-full bg-surface-sunken" />
      <span
        className="absolute h-1.5 rounded-full bg-primary"
        style={{ width: `${percent}%` }}
      />
      <span
        className="absolute h-4 w-4 -translate-x-1/2 rounded-full border-2 border-primary bg-surface-raised shadow-sm"
        style={{ left: `${percent}%` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
        className="relative h-5 w-full cursor-pointer opacity-0"
      />
    </span>
  );
}
