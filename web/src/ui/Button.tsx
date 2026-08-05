import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover shadow-sm',
  secondary:
    'border border-border-subtle bg-surface-raised text-content hover:border-border-strong hover:bg-surface-sunken',
  ghost: 'text-content hover:bg-surface-sunken',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-11 gap-2 px-5 text-sm',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  /** Stretches to fill its container — used in dialogs and the login form. */
  block?: boolean;
  /**
   * Adds breathing room above, for the submit button at the foot of a form.
   * Without it the button sits as close to the last field as the fields sit to
   * each other, and reads as just another row.
   */
  detached?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  block,
  detached,
  className,
  children,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex items-center justify-center rounded-control font-medium transition',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        detached && 'mt-5',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Circular rather than rounded-square; used in the top bar and viewer. */
  round?: boolean;
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  round = true,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const box = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-10 w-10';

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        'grid shrink-0 place-items-center transition',
        'disabled:pointer-events-none disabled:opacity-50',
        round ? 'rounded-full' : 'rounded-control',
        VARIANTS[variant],
        box,
        variant === 'ghost' && 'text-content-muted hover:text-content',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
