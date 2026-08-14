import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleAlert,
  Copy,
  FolderUp,
  LoaderCircle,
  Maximize2,
  Minus,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, matchPath, useLocation } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatBytes } from '../lib/format';
import {
  beginUploadHistory,
  createUploadHistoryId,
  finishUploadHistory,
  listenForUploadRetry,
  rememberUploadFiles,
  updateUploadHistoryItem,
  type UploadCandidate,
  type UploadDestination,
  type UploadHistoryItem,
  type UploadSource,
  type UploadStatus,
} from '../lib/uploadHistory';
import { useAuth } from '../store/auth';
import { Button, Checkbox, Tooltip } from '../ui';

interface Progress {
  total: number;
  done: number;
  created: number;
  duplicates: number;
  failed: number;
  bytesSent: number;
  bytesTotal: number;
  items: UploadProgressItem[];
}

interface UploadProgressItem {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0-1 for the file in flight, from real upload bytes. */
  fraction: number;
  error?: string;
}

interface DroppedEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (callback: (file: File) => void, onError?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (
      callback: (entries: DroppedEntry[]) => void,
      onError?: (error: DOMException) => void,
    ) => void;
  };
}

/** Keeps uploads fast without saturating a typical self-hosted NAS or browser. */
const WEB_UPLOAD_CONCURRENCY = 4;

const isMedia = (file: File) =>
  file.type.startsWith('image/') ||
  file.type.startsWith('video/') ||
  /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp|3gp|avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i.test(
    file.name,
  );

function UploadStatusIcon({ status }: { status: UploadStatus }) {
  if (status === 'uploading') {
    return <LoaderCircle size={14} className="animate-spin text-primary" />;
  }
  if (status === 'added') return <CheckCircle2 size={14} className="text-success" />;
  if (status === 'duplicate') return <Copy size={14} className="text-content-muted" />;
  if (status === 'failed') return <CircleAlert size={14} className="text-danger" />;
  if (status === 'cancelled') return <X size={14} className="text-content-muted" />;
  return <Circle size={14} className="text-content-subtle" />;
}

function uploadStatusLabel(item: UploadProgressItem) {
  if (item.status === 'uploading') return `${Math.round(item.fraction * 100)}%`;
  if (item.status === 'added') return 'Added';
  if (item.status === 'duplicate') return 'Already here';
  if (item.status === 'failed') return 'Failed';
  if (item.status === 'cancelled') return 'Stopped';
  return 'Queued';
}

async function filesFromEntry(entry: DroppedEntry, parent = ''): Promise<UploadCandidate[]> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;

  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    return isMedia(file) ? [{ file, relativePath: path }] : [];
  }

  if (!entry.isDirectory || !entry.createReader) return [];
  const reader = entry.createReader();
  const children: DroppedEntry[] = [];

  // DirectoryReader returns batches and an empty batch marks the end.
  while (true) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    children.push(...batch);
  }

  return (await Promise.all(children.map((child) => filesFromEntry(child, path)))).flat();
}

async function filesFromDrop(dataTransfer: DataTransfer): Promise<UploadCandidate[]> {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item): DroppedEntry | null =>
      (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => FileSystemEntry | null;
        }
      ).webkitGetAsEntry?.() as DroppedEntry | null,
    )
    .filter((entry): entry is DroppedEntry => Boolean(entry));

  if (entries.length > 0) return (await Promise.all(entries.map((entry) => filesFromEntry(entry)))).flat();
  return [...dataTransfer.files].filter(isMedia).map((file) => ({ file }));
}

/**
 * Uploads files or a whole directory.
 *
 * A directory gives every file a `webkitRelativePath`, which is forwarded so
 * the server rebuilds the same folder structure. Whatever folder or album the
 * person is looking at becomes the destination.
 */
export function UploadButton({
  compact = false,
  iconOnly = false,
  externalDrop = false,
  onError,
}: {
  compact?: boolean;
  /** Keeps the must-have upload action visible in a narrow top bar. */
  iconOnly?: boolean;
  /** One mounted instance owns Finder/Explorer drops for the whole app. */
  externalDrop?: boolean;
  onError?: (message: string) => void;
}) {
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const location = useLocation();
  const { user } = useAuth();
  // This button lives in Layout, above the child route that owns albumId or
  // folderId. useParams() therefore cannot see those child parameters.
  const albumId =
    matchPath('/albums/:albumId', location.pathname)?.params.albumId ??
    matchPath('/browse/albums/:albumId', location.pathname)?.params.albumId;
  const folderId =
    matchPath('/folders/:folderId', location.pathname)?.params.folderId ??
    matchPath('/browse/folders/:folderId', location.pathname)?.params.folderId;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [externalDrag, setExternalDrag] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const externalDragDepth = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * Opt-in, because the common case is repeating a backup and expecting it not
   * to double everything. Ticking this is how you say "yes, I mean it".
   */
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  /** Files the server already had, kept so they can be sent again on request. */
  const [skippedFiles, setSkippedFiles] = useState<UploadCandidate[]>([]);
  /** Failed candidates are retained so Retry sends only the files that need it. */
  const [failedFiles, setFailedFiles] = useState<UploadCandidate[]>([]);
  const [retryDestination, setRetryDestination] = useState<UploadDestination | null>(null);
  const [retrySource, setRetrySource] = useState<UploadSource>('files');
  const [minimized, setMinimized] = useState(false);
  const cancelled = useRef(false);
  const controllers = useRef(new Set<AbortController>());

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Warn before a reload throws away an upload in flight.
  useEffect(() => {
    if (!progress || progress.done >= progress.total) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [progress]);

  const uploadAll = async (
    fileList: FileList | File[] | UploadCandidate[] | null,
    forceDuplicate = false,
    destinationOverride?: UploadDestination,
    source: UploadSource = 'files',
  ) => {
    if (!fileList || fileList.length === 0) return;

    const files: UploadCandidate[] = [...fileList].map((item) =>
      item instanceof File
        ? {
            file: item,
            relativePath: (item as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
          }
        : item,
    );
    const bytesTotal = files.reduce((sum, { file }) => sum + file.size, 0);
    const uploadItems: UploadProgressItem[] = files.map(({ file, relativePath }, index) => ({
      id: `${createUploadHistoryId()}:${index}`,
      name: relativePath || file.name,
      size: file.size,
      status: 'queued',
      fraction: 0,
    }));
    const pageTitle = document.querySelector('main h1')?.textContent?.trim();
    const destination =
      destinationOverride ??
      ({
        ...(folderId ? { folderId } : {}),
        ...(albumId ? { albumId } : {}),
        label: folderId
          ? pageTitle ? `Folder · ${pageTitle}` : 'Folder'
          : albumId
            ? pageTitle ? `Album · ${pageTitle}` : 'Album'
            : 'Photos',
        path: location.pathname,
      } satisfies UploadDestination);
    const historyItems = () =>
      uploadItems.map(({ fraction: _fraction, ...item }): UploadHistoryItem => item);
    const historyId = user
      ? beginUploadHistory(user.id, source, destination, historyItems())
      : null;
    if (historyId) rememberUploadFiles(historyId, historyItems(), files);
    cancelled.current = false;
    setSkippedFiles([]);
    setFailedFiles([]);
    setRetryDestination(destination);
    setRetrySource(source);
    setMinimized(false);

    let created = 0;
    let duplicates = 0;
    let failed = 0;
    let done = 0;
    let nextIndex = 0;
    const uploadedBytes = files.map(() => 0);

    // Held so the finished panel can offer to send the skipped ones again as
    // deliberate copies — far easier to find than a checkbox you have to know
    // about before you start.
    const skipped: UploadCandidate[] = [];
    const retryable: UploadCandidate[] = [];

    const publishProgress = () =>
      setProgress({
        total: files.length,
        done,
        created,
        duplicates,
        failed,
        bytesSent: uploadedBytes.reduce((sum, bytes) => sum + bytes, 0),
        bytesTotal,
        items: [...uploadItems],
      });

    const uploadOne = async (index: number) => {
      const candidate = files[index];
      const { file, relativePath } = candidate;
      uploadItems[index] = { ...uploadItems[index], status: 'uploading', fraction: 0 };
      if (user && historyId) {
        const { fraction: _fraction, ...item } = uploadItems[index];
        updateUploadHistoryItem(user.id, historyId, item);
      }
      publishProgress();

      const form = new FormData();
      form.append('assetData', file);
      form.append('fileCreatedAt', new Date(file.lastModified).toISOString());
      form.append('fileModifiedAt', new Date(file.lastModified).toISOString());

      if (relativePath) form.append('relativePath', relativePath);

      // Whatever is on screen is the destination.
      if (folderId) form.append('folderId', folderId);
      if (albumId) form.append('albumId', albumId);

      if (allowDuplicate || forceDuplicate) form.append('allowDuplicate', 'true');

      const controller = new AbortController();
      controllers.current.add(controller);

      try {
        const { data } = await api.post('/assets/upload', form, {
          signal: controller.signal,
          // A multi-gigabyte video must not be cut off by a client timeout.
          timeout: 0,
          onUploadProgress: (event) => {
            const fraction = event.total ? Math.min(1, event.loaded / event.total) : 0;
            uploadedBytes[index] = Math.min(file.size, event.loaded);
            uploadItems[index] = { ...uploadItems[index], fraction };
            publishProgress();
          },
        });

        if (data.status === 'duplicate') {
          if (albumId) {
            // A duplicate means the bytes already exist in Photos, not that
            // the existing asset is already in this album. Link it instead of
            // asking the user to create another physical copy.
            await api.put(`/albums/${albumId}/assets`, { assetIds: [data.id] });
            created += 1;
            uploadItems[index] = { ...uploadItems[index], status: 'added', fraction: 1 };
          } else {
            duplicates += 1;
            skipped.push(candidate);
            uploadItems[index] = { ...uploadItems[index], status: 'duplicate', fraction: 1 };
          }
        } else {
          // A restored/organised asset already has bytes on disk, but it was
          // still added to the destination the user chose.
          if (albumId && data.status !== 'created') {
            await api.put(`/albums/${albumId}/assets`, { assetIds: [data.id] });
          }
          created += 1;
          uploadItems[index] = { ...uploadItems[index], status: 'added', fraction: 1 };
        }
        uploadedBytes[index] = file.size;
      } catch (error) {
        if (cancelled.current) {
          uploadItems[index] = { ...uploadItems[index], status: 'cancelled' };
        } else {
          const message = errorMessage(error);
          failed += 1;
          retryable.push(candidate);
          uploadItems[index] = {
            ...uploadItems[index],
            status: 'failed',
            error: message,
          };
          onError?.(`${file.name}: ${message}`);
        }
      } finally {
        controllers.current.delete(controller);
      }

      if (user && historyId) {
        const { fraction: _fraction, ...item } = uploadItems[index];
        updateUploadHistoryItem(user.id, historyId, item);
      }

      done += 1;
      publishProgress();
    };

    const worker = async () => {
      while (!cancelled.current) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= files.length) return;
        await uploadOne(index);
      }
    };

    publishProgress();
    await Promise.all(
      Array.from(
        { length: Math.min(WEB_UPLOAD_CONCURRENCY, files.length) },
        () => worker(),
      ),
    );

    if (cancelled.current) {
      for (const [index, item] of uploadItems.entries()) {
        if (item.status === 'queued') {
          uploadItems[index] = { ...item, status: 'cancelled' };
          done += 1;
        }
      }
    }

    setProgress({
      total: files.length,
      done: files.length,
      created,
      duplicates,
      failed,
      bytesSent: uploadedBytes.reduce((sum, bytes) => sum + bytes, 0),
      bytesTotal,
      items: [...uploadItems],
    });

    if (user && historyId) finishUploadHistory(user.id, historyId, historyItems());

    setSkippedFiles(skipped);
    setFailedFiles(retryable);
    await queryClient.invalidateQueries();

  };

  useEffect(() => {
    if (!externalDrop) return;
    return listenForUploadRetry((request) => {
      void uploadAll(request.files, false, request.destination, request.source);
    });
  });

  useEffect(() => {
    if (!externalDrop) return;

    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      externalDragDepth.current += 1;
      setExternalDrag(true);
    };
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      externalDragDepth.current = Math.max(0, externalDragDepth.current - 1);
      if (externalDragDepth.current === 0) setExternalDrag(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      externalDragDepth.current = 0;
      setExternalDrag(false);
      void filesFromDrop(event.dataTransfer)
        .then((files) => {
          if (files.length === 0) {
            const message = 'That folder does not contain supported photos or videos.';
            if (onError) onError(message);
            else setDropError(message);
            return;
          }
          return uploadAll(
            files,
            false,
            undefined,
            files.some((candidate) => candidate.relativePath?.includes('/')) ? 'folder' : 'drop',
          );
        })
        .catch((error) => {
          const message = errorMessage(error);
          if (onError) onError(message);
          else setDropError(message);
        });
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  });

  const pick = (which: 'files' | 'folder') => {
    setMenuOpen(false);
    (which === 'files' ? filesInput : folderInput).current?.click();
  };

  const overall = progress
    ? (progress.done / progress.total) * 100
    : 0;

  const running = progress !== null && progress.done < progress.total;
  const activeUploads = progress?.items.filter((item) => item.status === 'uploading').length ?? 0;
  const cancelledCount = progress?.items.filter((item) => item.status === 'cancelled').length ?? 0;
  const percentage = Math.max(0, Math.min(100, Math.round(overall)));
  const visibleUploadItems =
    !running && progress?.failed
      ? [
          ...progress.items.filter((item) => item.status === 'failed'),
          ...progress.items.filter((item) => item.status !== 'failed'),
        ]
      : progress?.items ?? [];
  const panelStatus: UploadStatus = running
    ? 'uploading'
    : progress?.failed
      ? 'failed'
      : cancelledCount > 0
        ? 'cancelled'
        : 'added';
  const panelTitle = running
    ? `Uploading ${activeUploads} ${activeUploads === 1 ? 'file' : 'files'}`
    : cancelledCount > 0
      ? 'Upload stopped'
      : progress?.failed
        ? 'Upload finished with errors'
        : 'Upload complete';

  const stopOrClose = () => {
    if (running) {
      cancelled.current = true;
      for (const controller of controllers.current) controller.abort();
      return;
    }
    setProgress(null);
    setFailedFiles([]);
    setSkippedFiles([]);
    setMinimized(false);
  };

  return (
    <>
      <div className="relative" ref={menuRef}>
        {/* One flat sky-blue upload control, matching the docs app preview. */}
        <div
          className={`flex items-center rounded-full bg-primary ${
            compact ? '' : 'w-full'
          }`}
        >
          <button
            type="button"
            onClick={() => pick('files')}
            aria-label={iconOnly ? 'Upload files' : undefined}
            className={
              iconOnly
                ? 'grid h-10 w-10 place-items-center rounded-l-full text-white transition hover:bg-black/10'
                : compact
                ? 'flex h-10 items-center gap-2 rounded-l-full pl-4 pr-3 text-sm font-medium text-white transition hover:bg-black/10'
                : 'flex h-10 w-full items-center justify-center gap-2 rounded-l-full px-4 text-sm font-medium text-white transition hover:bg-black/10'
            }
          >
            <Upload size={16} />
            {!iconOnly && 'Upload'}
          </button>
          {/* aria-label alone is invisible to sighted people, so the only
              control here without its own text label gets a real tooltip. */}
          <Tooltip label="Upload options">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Upload options"
              className="grid h-10 w-8 place-items-center rounded-r-full pr-1 text-white transition hover:bg-black/10"
            >
              <ChevronDown size={15} />
            </button>
          </Tooltip>
        </div>

        {menuOpen && (
          <div className="pop-in absolute right-0 top-12 z-50 w-60 overflow-hidden rounded-panel border border-border-subtle bg-surface-overlay p-1.5 shadow-popover">
            <button
              type="button"
              onClick={() => pick('files')}
              className="flex w-full items-center gap-2.5 rounded-[0.5rem] px-2.5 py-2 text-sm hover:bg-surface-sunken"
            >
              <Upload size={15} />
              Photos and videos
            </button>
            <button
              type="button"
              onClick={() => pick('folder')}
              className="flex w-full items-center gap-2.5 rounded-[0.5rem] px-2.5 py-2 text-left text-sm hover:bg-surface-sunken"
            >
              <FolderUp size={15} />
              <span>
                A whole folder
                <span className="block text-[11px] text-content-muted">Keeps its sub-folders</span>
              </span>
            </button>

            <div className="my-1 h-px bg-border-subtle" />

            <div className="rounded-[0.5rem] px-2.5 py-2 hover:bg-surface-sunken">
              <Checkbox
                checked={allowDuplicate}
                onChange={setAllowDuplicate}
                className="items-start gap-2.5"
                label={
                  <span>
                    Allow duplicates
                    <span className="block text-[11px] text-content-muted">
                      Keep a second copy of a file you already have
                    </span>
                  </span>
                }
              />
            </div>
          </div>
        )}
      </div>

      <input
        ref={filesInput}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => {
          void uploadAll(event.target.files, false, undefined, 'files');
          event.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        // Not in the React types, but every current browser supports it.
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        className="hidden"
        onChange={(event) => {
          void uploadAll(event.target.files, false, undefined, 'folder');
          event.target.value = '';
        }}
      />

      {externalDrag &&
        createPortal(
          <div className="pointer-events-none fixed inset-3 z-[100] grid place-items-center rounded-panel border-2 border-dashed border-primary bg-surface/90 backdrop-blur-xl">
            <div className="text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-primary-soft text-primary">
                <FolderUp size={30} />
              </span>
              <h2 className="mt-4 text-xl font-semibold">Drop to upload</h2>
              <p className="mt-1 text-sm text-content-muted">
                Photos, videos, or a whole folder
              </p>
              <p className="mt-1 text-xs text-content-muted">Folder structure will be preserved</p>
            </div>
          </div>,
          document.body,
        )}

      {dropError &&
        createPortal(
          <div className="fixed bottom-6 left-1/2 z-[101] flex -translate-x-1/2 items-center gap-3 rounded-control bg-danger-soft px-4 py-3 text-sm text-danger shadow-popover">
            <span>{dropError}</span>
            <button type="button" className="font-medium" onClick={() => setDropError(null)}>
              Dismiss
            </button>
          </div>,
          document.body,
        )}

      {/* Rendered into <body>, not in place.

          This button sits in the top bar, which uses `backdrop-blur`. A
          backdrop-filter makes that header the containing block for any
          `position: fixed` descendant, so `bottom-6` measured from the bottom
          of the 64px header rather than the window — putting the panel about
          50px above the top of the screen, where nobody could see it. */}
      {progress &&
        createPortal(
        <div
          className={`pop-in fixed bottom-6 right-6 z-50 rounded-panel border border-border-subtle bg-surface-overlay shadow-popover ${
            minimized ? 'w-72 p-3' : 'w-[22rem] p-4'
          }`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {minimized && (
                <span className="shrink-0">
                  <UploadStatusIcon status={panelStatus} />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{panelTitle}</span>
                <span className="block text-[11px] tabular-nums text-content-muted">
                  {progress.done} of {progress.total} files · {percentage}%
                </span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Tooltip label={minimized ? 'Show upload details' : 'Minimize'}>
                <button
                  type="button"
                  aria-label={minimized ? 'Show upload details' : 'Minimize upload'}
                  onClick={() => setMinimized((value) => !value)}
                  className="grid h-6 w-6 place-items-center rounded-full text-content-muted hover:bg-surface-sunken hover:text-content"
                >
                  {minimized ? <Maximize2 size={13} /> : <Minus size={14} />}
                </button>
              </Tooltip>
              <Tooltip label={running ? 'Stop' : 'Close'}>
                <button
                  type="button"
                  aria-label={running ? 'Stop upload' : 'Close upload'}
                  onClick={stopOrClose}
                  className="grid h-6 w-6 place-items-center rounded-full text-content-muted hover:bg-surface-sunken hover:text-content"
                >
                  <X size={13} />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-gradient-to-r from-secondary to-primary-deep transition-[width]"
              style={{ width: `${overall}%` }}
            />
          </div>

          {!minimized && (
            <>
              <p className="mt-2 text-[11px] tabular-nums text-content-muted">
                {formatBytes(progress.bytesSent)} of {formatBytes(progress.bytesTotal)}
              </p>

              <div
                className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1"
                aria-label="Upload files"
              >
                {visibleUploadItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex min-h-8 items-center gap-2 rounded-control bg-surface-sunken px-2.5 py-1.5"
                  >
                    <span className="shrink-0">
                      <UploadStatusIcon status={item.status} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Tooltip label={item.name} onlyWhenOverflow>
                        <span className="block truncate text-xs">{item.name}</span>
                      </Tooltip>
                      {item.error && (
                        <Tooltip label={item.error} onlyWhenOverflow>
                          <span className="block truncate text-[10px] text-danger">
                            {item.error}
                          </span>
                        </Tooltip>
                      )}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] tabular-nums ${
                        item.status === 'added'
                          ? 'text-success'
                          : item.status === 'failed'
                            ? 'text-danger'
                            : item.status === 'uploading'
                              ? 'text-primary'
                              : 'text-content-muted'
                      }`}
                    >
                      {uploadStatusLabel(item)}
                    </span>
                  </div>
                ))}
              </div>

              {!running && (
                <>
                  <p className="mt-2 text-xs text-content-muted">
                    {progress.created} added
                    {progress.duplicates > 0 && `, ${progress.duplicates} already here`}
                    {progress.failed > 0 && `, ${progress.failed} failed`}
                    {cancelledCount > 0 && `, ${cancelledCount} stopped`}
                  </p>

                  <Link
                    to="/upload-history"
                    onClick={() => setProgress(null)}
                    className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                  >
                    View upload history →
                  </Link>

                  {(failedFiles.length > 0 || progress.created > 0) && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {failedFiles.length > 0 && (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<RotateCcw size={14} />}
                          onClick={() => {
                            const retry = failedFiles;
                            setFailedFiles([]);
                            void uploadAll(
                              retry,
                              false,
                              retryDestination ?? undefined,
                              retrySource,
                            );
                          }}
                        >
                          Retry{' '}
                          {failedFiles.length === 1
                            ? 'failed file'
                            : `${failedFiles.length} failed files`}
                        </Button>
                      )}

                      {/* Photos are filed by the date they were taken, so an old scan
                          can land pages down and look like it never uploaded. */}
                      {progress.created > 0 && (
                        <Link
                          to="/?sort=added"
                          onClick={() => setProgress(null)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          See what was just added →
                        </Link>
                      )}
                    </div>
                  )}

                  {/* Skipping is the right default for a repeated backup, but when
                      someone deliberately picked a file they already have, "nothing
                      happened" is a dead end. Offer the way through, here, rather
                      than expecting them to have found a checkbox beforehand. */}
                  {skippedFiles.length > 0 && (
                    <div className="mt-3 border-t border-border-subtle pt-3">
                      <p className="text-xs text-content-muted">
                        {skippedFiles.length === 1
                          ? 'That file is already in your library.'
                          : `${skippedFiles.length} of those files are already in your library.`}{' '}
                        Upload again to keep a second copy?
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const again = skippedFiles;
                            setSkippedFiles([]);
                            void uploadAll(
                              again,
                              true,
                              retryDestination ?? undefined,
                              retrySource,
                            );
                          }}
                          className="rounded-control bg-primary px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-primary-hover"
                        >
                          Upload anyway
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSkippedFiles([]);
                            setProgress(null);
                          }}
                          className="rounded-control px-2.5 py-1.5 text-xs font-medium hover:bg-surface-sunken"
                        >
                          No thanks
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>,
          document.body,
        )}
    </>
  );
}
