import { cloneElement, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  label: string;
  children: ReactElement<{
    title?: string;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: () => void;
    onFocus?: () => void;
    onBlur?: () => void;
    ref?: React.Ref<HTMLElement>;
  }>;
  side?: 'top' | 'bottom';
  delay?: number;
  /** Show only when the wrapped label is visually clipped by ellipsis. */
  onlyWhenOverflow?: boolean;
}

const OFFSET = 6;
const EDGE = 8;

/**
 * Themed tooltip. The browser's native `title` cannot be styled, has a fixed
 * delay, and never appears for keyboard users.
 *
 * It also *strips* `title` from the wrapped element. Controls set a `title` of
 * their own so they still explain themselves when used without a Tooltip — but
 * leaving it in place here meant the native bubble appeared alongside this one.
 * Removing it in one place is safer than remembering to omit it at every call
 * site.
 */
export function Tooltip({
  label,
  children,
  side = 'bottom',
  delay = 350,
  onlyWhenOverflow = false,
}: Props) {
  const [box, setBox] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const target = useRef<HTMLElement | null>(null);

  const show = () => {
    timer.current = setTimeout(() => {
      const element = target.current;
      if (!element) return;
      if (
        onlyWhenOverflow &&
        element.scrollWidth <= element.clientWidth &&
        element.scrollHeight <= element.clientHeight
      ) return;

      const rect = element.getBoundingClientRect();

      // Flip above when there is not enough room below, so a control near the
      // foot of the window does not put its tooltip off-screen.
      const below = side === 'bottom';
      const room = window.innerHeight - rect.bottom;
      const placeBelow = below ? room > 44 : rect.top < 44;

      // Keep the bubble within the viewport horizontally too. The label is
      // roughly 7px per character plus padding — close enough to clamp by.
      const half = Math.min(label.length * 3.6 + 12, window.innerWidth / 2 - EDGE);
      const centre = rect.left + rect.width / 2;
      const x = Math.min(Math.max(centre, EDGE + half), window.innerWidth - EDGE - half);

      setBox({
        x,
        y: placeBelow ? rect.bottom + OFFSET : rect.top - OFFSET,
        above: !placeBelow,
      });
    }, delay);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setBox(null);
  };

  return (
    <>
      {cloneElement(children, {
        ref: target as React.Ref<HTMLElement>,
        // Suppress the native tooltip so only this one shows.
        title: undefined,
        onMouseEnter: show,
        onMouseLeave: hide,
        onFocus: show,
        onBlur: hide,
      })}

      {box &&
        createPortal(
          <span
            role="tooltip"
            className="fade-in pointer-events-none fixed z-[80] inline-flex min-h-7 max-w-[calc(100vw-1rem)] items-center whitespace-normal break-words rounded-lg bg-neutral-900 px-2.5 py-1 text-center text-[13px] font-medium text-white shadow-popover dark:bg-neutral-700"
            style={{
              left: box.x,
              top: box.y,
              // Centred on the anchor, and lifted fully above it when flipped.
              transform: `translateX(-50%)${box.above ? ' translateY(-100%)' : ''}`,
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}
