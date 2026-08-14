import { CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { dismissOperation, useOperationProgress } from '../lib/operationProgress';

/** Blocking feedback for structural changes and large batched actions. */
export function OperationProgressPanel() {
  const operation = useOperationProgress((state) => state.current);
  if (!operation) return null;

  const determinate = operation.total !== undefined && operation.total > 0;
  const percentage = determinate
    ? Math.round((operation.completed / operation.total!) * 100)
    : null;
  const running = operation.status === 'running';

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-surface/60 p-4 backdrop-blur-[2px]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="operation-progress-title"
        className="pop-in w-full max-w-sm rounded-panel border border-border-subtle bg-surface-overlay p-5 shadow-popover"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
            {running ? (
              <LoaderCircle size={20} className="animate-spin" />
            ) : operation.status === 'complete' ? (
              <CheckCircle2 size={20} className="text-success" />
            ) : (
              <CircleAlert size={20} className="text-danger" />
            )}
          </span>

          <span className="min-w-0 flex-1">
            <h2 id="operation-progress-title" className="text-sm font-semibold">
              {operation.status === 'complete' ? 'Finished' : operation.label}
            </h2>
            <p className="mt-0.5 text-xs tabular-nums text-content-muted">
              {operation.status === 'error'
                ? operation.error
                : determinate
                  ? `${operation.completed.toLocaleString()} of ${operation.total!.toLocaleString()} items · ${percentage}%`
                  : running
                    ? 'Working… Please keep this page open.'
                    : operation.label}
            </p>
          </span>

          {operation.status === 'error' && (
            <button
              type="button"
              aria-label="Close operation status"
              onClick={dismissOperation}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-content-muted hover:bg-surface-sunken hover:text-content"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className={`h-full rounded-full bg-gradient-to-r from-secondary to-primary-deep transition-[width] ${
              determinate ? '' : 'animate-pulse'
            }`}
            style={{ width: determinate ? `${percentage}%` : '42%' }}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
