import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  Copy,
  LoaderCircle,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBytes, formatInstant } from '../lib/format';
import {
  clearUploadHistory,
  removeUploadHistory,
  requestUploadRetry,
  retryableUploadFiles,
  useUploadHistory,
  type UploadCandidate,
  type UploadHistoryEntry,
  type UploadHistoryItem,
} from '../lib/uploadHistory';
import { useAuth } from '../store/auth';
import { Button, ConfirmDialog, EmptyState, Tooltip } from '../ui';

function StatusIcon({ entry }: { entry: UploadHistoryEntry }) {
  if (entry.status === 'uploading') {
    return <LoaderCircle size={18} className="animate-spin text-primary" />;
  }
  if (entry.status === 'complete') return <CheckCircle2 size={18} className="text-success" />;
  if (entry.status === 'cancelled') return <XCircle size={18} className="text-content-muted" />;
  return <CircleAlert size={18} className="text-danger" />;
}

function statusTitle(entry: UploadHistoryEntry) {
  if (entry.status === 'uploading') return 'Upload in progress';
  if (entry.status === 'complete') return 'Upload complete';
  if (entry.status === 'cancelled') return 'Upload stopped';
  if (entry.status === 'interrupted') return 'Upload interrupted';
  return 'Upload finished with errors';
}

function ItemIcon({ item }: { item: UploadHistoryItem }) {
  if (item.status === 'added' || item.status === 'confirmed') {
    return <CheckCircle2 size={14} className="text-success" />;
  }
  if (item.status === 'duplicate') return <Copy size={14} className="text-content-muted" />;
  if (item.status === 'failed') return <CircleAlert size={14} className="text-danger" />;
  if (item.status === 'cancelled') return <XCircle size={14} className="text-content-muted" />;
  return <LoaderCircle size={14} className="animate-spin text-primary" />;
}

function itemLabel(item: UploadHistoryItem) {
  if (item.status === 'added') return 'Added';
  if (item.status === 'confirmed') return 'Confirmed on server';
  if (item.status === 'duplicate') return 'Already here';
  if (item.status === 'failed') return 'Failed';
  if (item.status === 'cancelled') return 'Stopped';
  if (item.status === 'uploading') return 'Uploading';
  return 'Queued';
}

const problemItems = (entry: UploadHistoryEntry) =>
  entry.items.filter((item) => item.status === 'failed' || item.status === 'cancelled');

function candidatesFromFiles(files: FileList): UploadCandidate[] {
  return [...files].map((file) => ({
    file,
    relativePath:
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
  }));
}

function matchingFailedFile(candidate: UploadCandidate, failed: UploadHistoryItem[]) {
  const path = (candidate.relativePath || candidate.file.name).replaceAll('\\', '/');
  return failed.find((item) => {
    const expected = item.name.replaceAll('\\', '/');
    return (
      item.size === candidate.file.size &&
      (expected === path || expected.split('/').at(-1) === candidate.file.name)
    );
  });
}

export function UploadHistorySettings() {
  const { user } = useAuth();
  const entries = useUploadHistory(user?.id);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pickingEntryId, setPickingEntryId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const failedCount = entries.reduce((sum, entry) => sum + entry.summary.failed, 0);
  const retryRemembered = (entry: UploadHistoryEntry) => {
    const files = retryableUploadFiles(entry);
    if (files.length === 0) return false;
    requestUploadRetry({
      files,
      destination: entry.destination,
      source: entry.source,
      confirmBeforeRetry: true,
    });
    setMessage(`Retrying ${files.length} ${files.length === 1 ? 'file' : 'files'}.`);
    return true;
  };

  const chooseAgain = (entry: UploadHistoryEntry) => {
    setPickingEntryId(entry.id);
    setMessage(null);
    const usedFolder =
      entry.source === 'folder' || problemItems(entry).some((item) => item.name.includes('/'));
    (usedFolder ? folderInput : filesInput).current?.click();
  };

  const retrySelection = (list: FileList | null) => {
    const entry = entries.find((candidate) => candidate.id === pickingEntryId);
    setPickingEntryId(null);
    if (!entry || !list?.length) return;

    const failed = problemItems(entry);
    const selected = candidatesFromFiles(list).flatMap((candidate) => {
      const failedItem = matchingFailedFile(candidate, failed);
      return failedItem ? [{ ...candidate, uploadId: failedItem.id }] : [];
    });
    if (selected.length === 0) {
      setMessage('None of the selected files match the failed upload names.');
      return;
    }

    requestUploadRetry({
      files: selected,
      destination: entry.destination,
      source: entry.source,
      confirmBeforeRetry: true,
    });
    setMessage(
      selected.length === failed.length
        ? `Retrying all ${selected.length} failed files.`
        : `Retrying ${selected.length} of ${failed.length} failed files.`,
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-panel border border-border-subtle bg-surface-raised p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-semibold">Upload history</h2>
              <span className="text-xs tabular-nums text-content-muted">
                {entries.length === 0
                  ? 'No uploads recorded'
                  : `${entries.length} ${entries.length === 1 ? 'upload' : 'uploads'}${failedCount ? ` · ${failedCount} failed` : ''}`}
              </span>
            </div>
            <p className="mt-1 text-xs text-content-muted">
              Review completed uploads, understand failures, and retry files.
            </p>
          </div>

          {entries.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} />}
              onClick={() => setConfirmClear(true)}
            >
              Clear history
            </Button>
          )}
        </div>
      </section>

      {message && (
        <div className="flex items-center justify-between gap-3 rounded-control bg-primary-soft px-3.5 py-2.5 text-sm text-primary">
          <span>{message}</span>
          <button type="button" className="font-medium" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      {entries.length === 0 ? (
        <section className="rounded-panel border border-border-subtle bg-surface-raised">
          <EmptyState
            icon={Clock3}
            title="No upload history yet"
            description="Finished uploads and exact failure messages will stay here after you refresh the page."
          />
        </section>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-content-muted">
            Imadeo remembers file names and errors, but not the local file contents. After a refresh,
            select failed files again to retry them safely.
          </p>

          {entries.map((entry) => {
            const problems = problemItems(entry);
            const remembered = retryableUploadFiles(entry);
            const isExpanded = expanded.has(entry.id);
            const visibleItems = isExpanded ? entry.items : problems;
            const canExpand = entry.items.length > problems.length;

            return (
              <section
                key={entry.id}
                className="overflow-hidden rounded-panel border border-border-subtle bg-surface-raised"
              >
                <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-sunken">
                      <StatusIcon entry={entry} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-medium">{statusTitle(entry)}</h2>
                      <p className="mt-0.5 text-xs text-content-muted">
                        {formatInstant(entry.finishedAt ?? entry.startedAt)} ·{' '}
                        <Link to={entry.destination.path} className="text-primary hover:underline">
                          {entry.destination.label}
                        </Link>
                      </p>
                      <p className="mt-2 text-sm text-content-muted">
                        {entry.summary.added} added
                        {entry.summary.duplicates > 0 && ` · ${entry.summary.duplicates} already here`}
                        {entry.summary.failed > 0 && ` · ${entry.summary.failed} failed`}
                        {entry.summary.cancelled > 0 && ` · ${entry.summary.cancelled} stopped`}
                        {' · '}{formatBytes(entry.summary.bytesTotal)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {problems.length > 0 && entry.status !== 'uploading' && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<RotateCcw size={14} />}
                        onClick={() => {
                          if (!retryRemembered(entry)) chooseAgain(entry);
                        }}
                      >
                        {remembered.length > 0 ? 'Retry failed' : 'Select files to retry'}
                      </Button>
                    )}
                    <Tooltip label="Remove from history">
                      <button
                        type="button"
                        aria-label="Remove from history"
                        onClick={() => user && removeUploadHistory(user.id, entry.id)}
                        className="grid h-8 w-8 place-items-center rounded-full text-content-muted transition hover:bg-surface-sunken hover:text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>

                {(visibleItems.length > 0 || entry.omittedItems) && (
                  <div className="border-t border-border-subtle bg-surface px-4 py-3">
                    <div className="space-y-1.5">
                      {visibleItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex min-h-10 items-center gap-2 rounded-control bg-surface-sunken px-3 py-2"
                        >
                          <span className="shrink-0"><ItemIcon item={item} /></span>
                          <span className="min-w-0 flex-1">
                            <Tooltip label={item.name} onlyWhenOverflow>
                              <span className="block truncate text-xs">{item.name}</span>
                            </Tooltip>
                            {item.error && (
                              <Tooltip label={item.error} onlyWhenOverflow>
                                <span className="block truncate text-[11px] text-danger">{item.error}</span>
                              </Tooltip>
                            )}
                          </span>
                          <span className="shrink-0 text-[11px] text-content-muted">
                            {itemLabel(item)} · {formatBytes(item.size)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {entry.omittedItems ? (
                      <p className="mt-2 text-xs text-content-muted">
                        {entry.omittedItems} successful rows were compacted to save browser storage.
                      </p>
                    ) : null}

                    {canExpand && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((current) => {
                            const next = new Set(current);
                            if (next.has(entry.id)) next.delete(entry.id);
                            else next.add(entry.id);
                            return next;
                          })
                        }
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        {isExpanded ? 'Show only problems' : `Show all ${entry.summary.total} files`}
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <input
        ref={filesInput}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => {
          retrySelection(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        className="hidden"
        onChange={(event) => {
          retrySelection(event.target.files);
          event.target.value = '';
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        title="Clear upload history?"
        description="This removes saved upload names and errors. It does not delete any photos."
        confirmLabel="Clear history"
        destructive
        onConfirm={() => user && clearUploadHistory(user.id)}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
