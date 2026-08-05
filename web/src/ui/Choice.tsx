import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

interface Shared {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

/**
 * Radio and checkbox for the design system.
 *
 * Both replace the native controls, which cannot be themed: the browser paints
 * them from the OS, so they ignore the accent colour, sit at the wrong size next
 * to a 32px control, and look wrong in dark mode. Built from a button and a
 * span, they follow the same tokens as everything else.
 *
 * The real input is still there, visually hidden, so screen readers and the
 * keyboard behave exactly as they would natively.
 */
function Control({
  type,
  name,
  label,
  checked,
  disabled,
  onChange,
  className,
}: Shared & { type: 'radio' | 'checkbox'; name?: string }) {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-center gap-2 text-sm transition',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        // Not `hidden`: a hidden input is skipped by assistive technology and
        // cannot be focused. Kept in the layout but invisible instead.
        className="peer sr-only"
      />

      <span
        className={clsx(
          'grid h-4 w-4 shrink-0 place-items-center border-2 transition',
          type === 'radio' ? 'rounded-full' : 'rounded-[0.3rem]',
          checked ? 'border-accent' : 'border-border-strong',
          checked && type === 'checkbox' && 'bg-accent',
          // Focus follows the real input, so keyboard users see the ring.
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
        )}
      >
        {checked &&
          (type === 'radio' ? (
            <span className="h-2 w-2 rounded-full bg-accent" />
          ) : (
            <Check size={11} strokeWidth={3.5} className="text-white" />
          ))}
      </span>

      {label}
    </label>
  );
}

export function Radio(props: Shared & { name?: string }) {
  return <Control type="radio" {...props} />;
}

export function Checkbox(props: Shared) {
  return <Control type="checkbox" {...props} />;
}
