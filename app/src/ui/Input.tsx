import clsx from 'clsx';
import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

// The native `size` attribute is a character count, which nothing here uses and
// which would collide with the design-system size scale.
interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  /** Rendered inside the field on the left, e.g. a search glyph. */
  adornment?: ReactNode;
  trailing?: ReactNode;
  /**
   * Sizes the wrapper. `className` styles the `<input>` itself, so a width set
   * there has no effect — the wrapper is what occupies space in a flex row, and
   * it defaults to full width. Toolbars need to constrain it.
   */
  containerClassName?: string;
  /**
   * Height must be a prop, not a `className` override: Tailwind decides which
   * of two `h-*` utilities wins by their order in the generated stylesheet, so
   * passing `h-8` alongside the built-in `h-10` silently lost. `sm` matches the
   * small Button and Select, so toolbars line up.
   */
  size?: 'sm' | 'md' | 'lg';
  // React 19 passes `ref` to function components as an ordinary prop.
  ref?: Ref<HTMLInputElement>;
}

/** Heights mirror Button and Select so mixed toolbars sit on one line. */
const SIZES = {
  sm: 'h-8 text-xs',
  md: 'h-10 text-sm',
  lg: 'h-11 text-sm',
} as const;

export function Input({
  label,
  hint,
  error,
  adornment,
  trailing,
  className,
  containerClassName,
  size = 'md',
  id,
  ref,
  ...rest
}: Props) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <div className={containerClassName ?? 'w-full'}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-content-muted">
          {label}
        </label>
      )}

      <div className="relative">
        {adornment && (
          <span
            className={clsx(
              'pointer-events-none absolute top-1/2 -translate-y-1/2 text-content-muted',
              size === 'sm' ? 'left-3' : 'left-3.5',
            )}
          >
            {adornment}
          </span>
        )}

        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          className={clsx(
            'w-full rounded-control border bg-surface-raised outline-none transition',
            'placeholder:text-content-muted/70',
            SIZES[size],
            adornment ? (size === 'sm' ? 'pl-8' : 'pl-10') : size === 'sm' ? 'pl-3' : 'pl-3.5',
            trailing ? 'pr-9' : size === 'sm' ? 'pr-3' : 'pr-3.5',
            error ? 'border-danger' : 'border-border-subtle focus:border-primary',
            className,
          )}
          {...rest}
        />

        {trailing && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span>
        )}
      </div>

      {(error || hint) && (
        <p className={clsx('mt-1.5 text-xs', error ? 'text-danger' : 'text-content-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
