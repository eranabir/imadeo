import clsx from 'clsx';
import { Check } from 'lucide-react';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Announced to screen readers, e.g. "Select the 4 photos from Jun 13, 2024". */
  label: string;
  /**
   * `media` sits on top of a photo, so it borrows a white border and needs no
   * background of its own. `surface` sits on a page background, where a white
   * border would be invisible.
   */
  tone?: 'media' | 'surface';
  className?: string;
}

/**
 * The round check used to select things — one photo, or a whole day from its
 * date heading.
 *
 * It lives here rather than inside the grid because it appears in both places,
 * and two copies drifted apart: the grid drew this circle while a date heading
 * used the square `Checkbox`, so selecting one photo and selecting its whole day
 * looked like two unrelated actions.
 */
export function SelectionCheck({ checked, onChange, label, tone = 'surface', className }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition',
        checked
          ? 'border-primary bg-primary text-white'
          : tone === 'media'
            ? 'border-white/85 bg-black/25 text-transparent'
            : 'border-content-muted/50 text-transparent hover:border-content-muted',
        className,
      )}
    >
      <Check size={14} strokeWidth={3} />
    </button>
  );
}
