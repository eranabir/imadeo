import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Popover, anchorFromElement, type Anchor } from './Popover';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: string;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label?: string;
  /** Shown before the current value, e.g. "Sort by". */
  prefix?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Replaces the native `<select>`, which cannot be themed consistently across
 * browsers and looked out of place next to the rest of the system.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  prefix,
  size = 'md',
  className,
}: Props<T>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const current = options.find((option) => option.value === value);

  return (
    <>
      {label && <span className="mb-1.5 block text-xs font-medium text-content-muted">{label}</span>}

      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={Boolean(anchor)}
        onClick={() => setAnchor(anchor ? null : anchorFromElement(trigger.current!))}
        className={clsx(
          'inline-flex items-center gap-2 rounded-control border border-border-subtle',
          'bg-surface-raised font-medium text-content transition hover:border-border-strong',
          size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-3.5 text-sm',
          className,
        )}
      >
        {current?.icon}
        <span className="truncate">
          {prefix && <span className="text-content-muted">{prefix} </span>}
          {current?.label ?? value}
        </span>
        <ChevronDown size={14} className="text-content-muted" />
      </button>

      {anchor && (
        <Popover
          anchor={anchor}
          onDismiss={() => setAnchor(null)}
          align="end"
          trigger={trigger.current}
          className="min-w-48 py-1.5"
        >
          <div role="listbox" className="px-1.5">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setAnchor(null);
                }}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-[0.5rem] px-2.5 py-2 text-left text-sm transition',
                  option.value === value
                    ? 'bg-primary-soft text-primary'
                    : 'text-content hover:bg-surface-sunken',
                )}
              >
                {option.icon && <span className="w-4 shrink-0">{option.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.hint && (
                    <span className="block truncate text-[11px] text-content-muted">
                      {option.hint}
                    </span>
                  )}
                </span>
                {option.value === value && <Check size={14} />}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
