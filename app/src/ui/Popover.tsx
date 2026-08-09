import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface Anchor {
  x: number;
  y: number;
  /** Width of the trigger, so a dropdown can match it. */
  width?: number;
  height?: number;
}

interface Props {
  anchor: Anchor;
  onDismiss: () => void;
  children: ReactNode;
  /** Align the panel's left edge, right edge, or centre to the anchor. */
  align?: 'start' | 'end' | 'center';
  /** The element that opened the popover. Pressing it again should toggle closed. */
  trigger?: HTMLElement | null;
  matchWidth?: boolean;
  className?: string;
}

const MARGIN = 8;

/**
 * The single floating layer used by every menu, dropdown and tooltip.
 *
 * Rendered in a portal so it is never clipped by a scroll container, and
 * flipped/clamped so it can't run off screen — the reason to have one
 * implementation instead of a hand-rolled absolute div per feature.
 */
export function Popover({
  anchor,
  onDismiss,
  children,
  align = 'start',
  trigger,
  matchWidth,
  className,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;

    const { width, height } = element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left =
      align === 'end'
        ? anchor.x + (anchor.width ?? 0) - width
        : align === 'center'
          ? anchor.x + (anchor.width ?? 0) / 2 - width / 2
          : anchor.x;

    let top = anchor.y + (anchor.height ?? 0) + 6;

    // Flip above the trigger when there is no room below.
    if (top + height > viewportHeight - MARGIN) {
      const above = anchor.y - height - 6;
      top = above >= MARGIN ? above : Math.max(MARGIN, viewportHeight - height - MARGIN);
    }

    left = Math.min(Math.max(MARGIN, left), viewportWidth - width - MARGIN);

    setPosition({ left, top });
  }, [anchor, align]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    const onPointer = (event: MouseEvent) => {
      // A trigger lives outside the panel, but it is still part of the same
      // control. Treating its second press as an outside click closes here and
      // then reopens in the trigger's click handler.
      if (trigger?.contains(event.target as Node)) return;
      if (panel.current && !panel.current.contains(event.target as Node)) onDismiss();
    };
    // `true` so the dismissal wins over handlers that stop propagation.
    document.addEventListener('mousedown', onPointer, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);

    return () => {
      document.removeEventListener('mousedown', onPointer, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    };
  }, [onDismiss, trigger]);

  return createPortal(
    <div
      ref={panel}
      role="presentation"
      className={clsx(
        'pop-in fixed z-[60] overflow-hidden rounded-panel border border-border-subtle',
        'bg-surface-overlay shadow-popover',
        className,
      )}
      style={{
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        width: matchWidth ? anchor.width : undefined,
        // Avoid a flash at the wrong spot on the first paint.
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Turns a DOM element into an anchor rectangle. */
export const anchorFromElement = (element: HTMLElement): Anchor => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};

/** Turns a pointer position into a zero-size anchor, for context menus. */
export const anchorFromPoint = (x: number, y: number): Anchor => ({ x, y, width: 0, height: 0 });
