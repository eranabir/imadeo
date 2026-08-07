import clsx from 'clsx';
import { useEffect, useRef, type ReactNode } from 'react';
import { Popover, type Anchor } from './Popover';

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a divider above this item. */
  separated?: boolean;
  checked?: boolean;
}

interface Props {
  anchor: Anchor;
  items: MenuItem[];
  onDismiss: () => void;
  align?: 'start' | 'end' | 'center';
  matchWidth?: boolean;
  header?: ReactNode;
  className?: string;
}

/**
 * The dropdown used everywhere: the account menu, the upload split-button, the
 * sort control and the right-click menu on a photo. One component means one set
 * of paddings, hover states and keyboard behaviour across the app.
 */
export function Menu({
  anchor,
  items,
  onDismiss,
  align = 'start',
  matchWidth,
  header,
  className,
}: Props) {
  /**
   * A context menu opens directly under the pointer, so the tail end of the
   * very gesture that opened it — the mouseup and click that follow
   * contextmenu, or a second click on a button — lands on whatever item is now
   * beneath the cursor and fires it. That is how a right-click could silently
   * delete something. Item activation is ignored until the menu has been up
   * long enough for the opening gesture to be over.
   */
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const settled = () => Date.now() - openedAt.current > 250;

  return (
    <Popover
      anchor={anchor}
      onDismiss={onDismiss}
      align={align}
      matchWidth={matchWidth}
      className={clsx('min-w-52 py-2', className)}
    >
      {header && <div className="border-b border-border-subtle px-3 pb-2.5 pt-1">{header}</div>}

      {/* The extra top padding only applies under a header: without it the first
          item butts against the divider and sits noticeably higher in its row
          than every item below it. */}
      <div role="menu" className={clsx('space-y-0.5 px-1.5', header && 'pt-1.5')}>
        {items.map((item) => (
          <div key={item.id}>
            {item.separated && <div className="my-1.5 h-px bg-border-subtle" />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (!settled()) return;
                item.onSelect?.();
                onDismiss();
              }}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-[0.5rem] px-2.5 py-2 text-left text-sm transition',
                'disabled:pointer-events-none disabled:opacity-45',
                item.danger
                  ? 'text-danger hover:bg-danger-soft'
                  : 'text-content hover:bg-surface-sunken',
              )}
            >
              {item.icon && <span className="grid w-4 shrink-0 place-items-center">{item.icon}</span>}

              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                {item.hint && (
                  <span className="block truncate text-[11px] text-content-muted">{item.hint}</span>
                )}
              </span>

              {item.checked && <span className="text-primary">✓</span>}
            </button>
          </div>
        ))}
      </div>
    </Popover>
  );
}
