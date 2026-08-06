import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'sm',
}: Props) {
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Stop the page behind the dialog from scrolling under it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <div
        className="fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        role="presentation"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          // A column with a capped height, so a long description or a tall body
          // scrolls inside the dialog instead of growing past the top and
          // bottom of the window where it cannot be reached. `dvh` rather than
          // `vh` because mobile browser chrome makes `vh` overshoot.
          'pop-in relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden',
          'rounded-panel border border-border-subtle bg-surface-overlay shadow-popover',
          widths[width],
        )}
      >
        {/* The title and the close button stay put; everything else scrolls. */}
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pt-4">
          {/* Names are user supplied and can be long and unbroken, so wrap
              mid-word rather than letting the dialog blow out. */}
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold [overflow-wrap:anywhere]">
            {title}
          </h2>
          <IconButton label="Close" size="sm" onClick={onClose} className="shrink-0">
            <X size={15} />
          </IconButton>
        </header>

        {/* `min-h-0` is what actually lets a flex child shrink enough to scroll. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-1">
          {description && (
            <p className="text-sm text-content-muted [overflow-wrap:anywhere]">{description}</p>
          )}
          {children && <div className={description ? 'mt-4' : 'mt-3'}>{children}</div>}
        </div>

        {footer && (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Replaces window.confirm, which browsers suppress and cannot be themed. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
  onClose,
}: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
