import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
}

/** Toggleable filter pill, used by the search filters and anywhere else facets appear. */
export function Chip({ active, icon, className, children, type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition',
        active
          ? 'bg-primary text-white'
          : 'border border-border-subtle text-content hover:border-border-strong hover:bg-surface-sunken',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
