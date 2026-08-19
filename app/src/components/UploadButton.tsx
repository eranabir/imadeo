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
import { api, ensureFreshBrowserSession, errorMessage } from '../lib/api';
import { createBrowserThumbnail } from '../lib/browserThumbnail';
import { formatBytes } from '../lib/format';
import { buildUploadForm } from '../lib/uploadForm';
import {
  classifyUploadCandidates,
  ensureFileReadable,
  filesFromDrop,
  MEDIA_ACCEPT,
  uploadRootSegments,
} from '../lib/uploadSelection';
import {
  combineUploadProgress,
  type UploadProgress,
  type UploadProgressItem,
} from '../lib/uploadProgress';
import { createUploadLimiter, runUploadQueue } from '../lib/uploadQueue';
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
import { Button, Tooltip } from '../ui';

/** Keeps uploads fast without saturating a typical self-hosted NAS or browser. */
const WEB_UPLOAD_CONCURRENCY = 4;

interface FailedUploadBatch {
  files: UploadCandidate[];
  destination: UploadDestination;
  source: UploadSource;
}

interface UploadReceiptStatus {
  uploadId: string;
  assetId: string | null;
  exists: boolean;
}

async function checkUploadReceipts(uploadIds: string[], uploadBatchId: string) {
  if (uploadIds.length === 0) return [];
  const { data } = await api.post<UploadReceiptStatus[]>('/assets/upload-status', {
    uploadIds,
    uploadBatchId,
    deferProcessing: true,
  });
  return data;
}

function UploadStatusIcon({ status }: { status: UploadStatus }) {
  if (status === 'uploading') {
    return <LoaderCircle size={14} className="animate-spin text-primary" />;
  }
  if (status === 'added' || status === 'confirmed') {
    return <CheckCircle2 size={14} className="text-success" />;
  }
  if (status === 'duplicate') return <Copy size={14} className="text-content-muted" />;
  if (status === 'failed') return <CircleAlert size={14} className="text-danger" />;
  if (status === 'cancelled') return <X size={14} className="text-content-muted" />;
  return <Circle size={14} className="text-content-subtle" />;
}

function uploadStatusLabel(item: UploadProgressItem) {
  if (item.status === 'uploading') return `${Math.round(item.fraction * 100)}%`;
  if (item.status === 'added') return 'Added';
  if (item.status === 'confirmed') return 'Confirmed on server';
  if (item.status === 'duplicate') return 'Already here';
  if (item.status === 'failed') return 'Failed';
  if (item.status === 'cancelled') return 'Stopped';
  return 'Queued';
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
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const progressRuns = useRef(new Map<string, UploadProgress>());
  const [externalDrag, setExternalDrag] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const externalDragDepth = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Failed batches retain their own destination so a combined retry stays correctly filed. */
  const [failedBatches, setFailedBatches] = useState<FailedUploadBatch[]>([]);
  const [minimized, setMinimized] = useState(false);
  const runControls = useRef(new Map<string, { cancelled: boolean }>());
  const controllers = useRef(new Set<AbortController>());
  const limitUpload = useRef(createUploadLimiter(WEB_UPLOAD_CONCURRENCY)).current;
  const refreshTimer = useRef<number | null>(null);

  const scheduleLibraryRefresh = () => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['folders'] }),
        queryClient.invalidateQueries({ queryKey: ['albums'] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
    }, 1_000);
  };

  useEffect(() => () => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
  }, []);

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

  const publishCombinedProgress = () => {
    // New drops appear first in the list, while every earlier running batch
    // remains visible and continues contributing to the totals.
    setProgress(combineUploadProgress([...progressRuns.current.values()].reverse()));
  };

  const closeProgress = () => {
    progressRuns.current.clear();
    setProgress(null);
    setFailedBatches([]);
    setMinimized(false);
  };

  const uploadAll = async (
    fileList: FileList | File[] | UploadCandidate[] | null,
    destinationOverride?: UploadDestination,
    source: UploadSource = 'files',
    confirmBeforeRetry = false,
  ) => {
    if (!fileList || fileList.length === 0) return;

    const uploadBatchId = createUploadHistoryId();

    const candidates: UploadCandidate[] = [...fileList].map((item) => {
      const candidate: UploadCandidate =
        item instanceof File
          ? {
            file: item,
            relativePath: (item as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
          }
          : item;
      return {
        ...candidate,
        // Retrying keeps this id so a lost response confirms the same request;
        // selecting the same bytes again creates a new candidate and a new id.
        uploadId: candidate.uploadId ?? createUploadHistoryId(),
      };
    });
    const { media: files, unsupported } = classifyUploadCandidates(candidates);
    const ignored = unsupported.length;
    if (files.length === 0) {
      const message = 'That selection does not contain supported photos or videos.';
      if (onError) onError(message);
      else setDropError(message);
      return;
    }
    const bytesTotal = files.reduce((sum, { file }) => sum + file.size, 0);
    const uploadItems: UploadProgressItem[] = files.map(({ file, relativePath, uploadId }) => ({
      id: uploadId!,
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
    const hasRunningUpload = [...progressRuns.current.values()].some(
      (run) => run.done < run.total,
    );
    if (!hasRunningUpload) {
      progressRuns.current.clear();
      setFailedBatches([]);
    }
    const runControl = { cancelled: false };
    runControls.current.set(uploadBatchId, runControl);
    const historyItems = () =>
      uploadItems.map(({ fraction: _fraction, ...item }): UploadHistoryItem => item);
    const historyId = user
      ? beginUploadHistory(user.id, source, destination, historyItems())
      : null;
    if (historyId) rememberUploadFiles(historyId, historyItems(), files);
    setMinimized(false);

    let created = 0;
    let confirmed = 0;
    let duplicates = 0;
    let failed = 0;
    let bytesConfirmed = 0;
    let done = 0;
    const uploadedBytes = files.map(() => 0);
    const storedAssetIds = new Set<string>();

    const retryable: UploadCandidate[] = [];

    const publishProgress = () => {
      progressRuns.current.set(uploadBatchId, {
        total: files.length,
        ignored,
        done,
        created,
        confirmed,
        duplicates,
        failed,
        bytesSent: uploadedBytes.reduce((sum, bytes) => sum + bytes, 0),
        bytesConfirmed,
        bytesTotal,
        items: [...uploadItems],
      });
      publishCombinedProgress();
    };

    const uploadOne = async (index: number) => {
      const candidate = files[index];
      const { file, uploadId } = candidate;
      uploadItems[index] = { ...uploadItems[index], status: 'uploading', fraction: 0 };
      if (user && historyId) {
        const { fraction: _fraction, ...item } = uploadItems[index];
        updateUploadHistoryItem(user.id, historyId, item);
      }
      publishProgress();

      const form = buildUploadForm(candidate, destination, uploadBatchId);

      const controller = new AbortController();
      controllers.current.add(controller);

      try {
        if (confirmationError) throw new Error(confirmationError);

        const existingReceipt = confirmedReceipts.get(uploadId!);
        if (existingReceipt) {
          storedAssetIds.add(existingReceipt);
          if (destination.albumId) {
            await api.put(`/albums/${destination.albumId}/assets`, {
              assetIds: [existingReceipt],
            });
          }
          confirmed += 1;
          bytesConfirmed += file.size;
          uploadItems[index] = { ...uploadItems[index], status: 'confirmed', fraction: 1 };
        } else {
          await ensureFileReadable(file);
          const browserThumbnail = createBrowserThumbnail(file);
          // A 401 received after a multi-gigabyte body wastes the entire
          // transfer. Refresh before opening the request, while concurrent
          // files share the same refresh operation.
          await ensureFreshBrowserSession();
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
          storedAssetIds.add(data.id);

          // Give the grid something small to render immediately. This is only
          // a provisional derivative; the idle server job replaces it later.
          const thumbnail = await browserThumbnail;
          if (thumbnail) {
            const preview = new FormData();
            preview.append('thumbnailData', thumbnail, 'browser-preview.jpg');
            await api
              .post(`/assets/${data.id}/browser-thumbnail`, preview, { timeout: 10_000 })
              .catch(() => undefined);
          }
          scheduleLibraryRefresh();

          if (data.status === 'confirmed') {
            if (destination.albumId) {
              await api.put(`/albums/${destination.albumId}/assets`, { assetIds: [data.id] });
            }
            confirmed += 1;
            uploadItems[index] = { ...uploadItems[index], status: 'confirmed', fraction: 1 };
          } else if (data.status === 'duplicate') {
            if (destination.albumId) {
            // A duplicate means the bytes already exist in Photos, not that
            // the existing asset is already in this album. Link it instead of
            // asking the user to create another physical copy.
              await api.put(`/albums/${destination.albumId}/assets`, { assetIds: [data.id] });
              created += 1;
              uploadItems[index] = { ...uploadItems[index], status: 'added', fraction: 1 };
            } else {
              duplicates += 1;
              uploadItems[index] = { ...uploadItems[index], status: 'duplicate', fraction: 1 };
            }
          } else {
            // A restored/organised asset already has bytes on disk, but it was
            // still added to the destination the user chose.
            if (destination.albumId && data.status !== 'created') {
              await api.put(`/albums/${destination.albumId}/assets`, { assetIds: [data.id] });
            }
            created += 1;
            uploadItems[index] = { ...uploadItems[index], status: 'added', fraction: 1 };
          }
          uploadedBytes[index] = file.size;
        }
      } catch (error) {
        if (runControl.cancelled) {
          uploadItems[index] = { ...uploadItems[index], status: 'cancelled' };
        } else {
          let committedAssetId: string | null = null;
          if (!confirmationError && uploadedBytes[index] >= file.size) {
            try {
              const [receipt] = await checkUploadReceipts([uploadId!], uploadBatchId);
              committedAssetId = receipt?.exists ? receipt.assetId : null;
              if (committedAssetId) storedAssetIds.add(committedAssetId);
              if (committedAssetId && destination.albumId) {
                await api.put(`/albums/${destination.albumId}/assets`, {
                  assetIds: [committedAssetId],
                });
              }
            } catch {
              // The connection may still be unavailable; Retry performs this
              // confirmation again before it sends any bytes.
            }
          }

          if (committedAssetId) {
            confirmed += 1;
            uploadItems[index] = { ...uploadItems[index], status: 'confirmed', fraction: 1 };
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

    const confirmedReceipts = new Map<string, string>();
    let confirmationError: string | null = null;
    publishProgress();

    // Create the selected directory's visible root before sending its files.
    // The upload requests still ensure every nested path, but Browse no longer
    // looks unchanged until the last byte of a large folder has arrived.
    const roots = uploadRootSegments(files);
    if (roots.length > 0) {
      try {
        await Promise.all(
          roots.map((segment) =>
            api.post('/folders/ensure-path', {
              segments: [segment],
              rootId: destination.folderId ?? null,
            }),
          ),
        );
        await queryClient.invalidateQueries({ queryKey: ['folders'] });
      } catch {
        // Each upload request still ensures its full path. A brief failure of
        // this eager UI step must not strand the entire selection as queued.
      }
    }

    if (confirmBeforeRetry) {
      try {
        const receipts = await checkUploadReceipts(
          files.map((file) => file.uploadId!),
          uploadBatchId,
        );
        for (const receipt of receipts) {
          if (receipt.exists && receipt.assetId) {
            confirmedReceipts.set(receipt.uploadId, receipt.assetId);
          }
        }
      } catch (error) {
        confirmationError = `Could not confirm the upload with the server: ${errorMessage(error)}`;
      }
    }
    await runUploadQueue(
      files,
      WEB_UPLOAD_CONCURRENCY,
      (_candidate, index) =>
        limitUpload(async () => {
          if (runControl.cancelled) return;
          await uploadOne(index);
        }),
      () => runControl.cancelled,
    );

    // Only now do metadata, thumbnails, video conversion, search, and
    // recognition begin. If this request is lost, the server's idle recovery
    // starts the same stored assets later without re-uploading their bytes.
    await api
      .post('/assets/upload-complete', {
        batchId: uploadBatchId,
        assetIds: [...storedAssetIds],
      })
      .catch(() => undefined);

    if (runControl.cancelled) {
      for (const [index, item] of uploadItems.entries()) {
        if (item.status === 'queued') {
          uploadItems[index] = { ...item, status: 'cancelled' };
          done += 1;
        }
      }
    }

    progressRuns.current.set(uploadBatchId, {
      total: files.length,
      ignored,
      done: files.length,
      created,
      confirmed,
      duplicates,
      failed,
      bytesSent: uploadedBytes.reduce((sum, bytes) => sum + bytes, 0),
      bytesConfirmed,
      bytesTotal,
      items: [...uploadItems],
    });
    publishCombinedProgress();
    runControls.current.delete(uploadBatchId);

    if (user && historyId) finishUploadHistory(user.id, historyId, historyItems());

    if (retryable.length > 0) {
      setFailedBatches((batches) => [...batches, { files: retryable, destination, source }]);
    }
    // Refresh each affected collection once. Thumbnail completion is handled
    // separately by one batched readiness poll, not two global invalidations
    // that make every visible image request itself again.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['folders'] }),
      queryClient.invalidateQueries({ queryKey: ['albums'] }),
      queryClient.invalidateQueries({ queryKey: ['assets'] }),
      queryClient.invalidateQueries({ queryKey: ['users', 'statistics'] }),
    ]);
  };

  useEffect(() => {
    if (!externalDrop) return;
    return listenForUploadRetry((request) => {
      void uploadAll(
        request.files,
        request.destination,
        request.source,
        request.confirmBeforeRetry,
      );
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
          return uploadAll(
            files,
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
      for (const control of runControls.current.values()) control.cancelled = true;
      for (const controller of controllers.current) controller.abort();
      return;
    }
    closeProgress();
  };

  const failedFileCount = failedBatches.reduce((total, batch) => total + batch.files.length, 0);

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
          </div>
        )}
      </div>

      <input
        ref={filesInput}
        type="file"
        multiple
        accept={MEDIA_ACCEPT}
        className="hidden"
        onChange={(event) => {
          void uploadAll(event.target.files, undefined, 'files');
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
          void uploadAll(event.target.files, undefined, 'folder');
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
                  {progress.done} of {progress.total} media files · {percentage}%
                </span>
                {progress.ignored > 0 && (
                  <span className="block text-[11px] tabular-nums text-content-muted">
                    {progress.ignored} unsupported {progress.ignored === 1 ? 'file' : 'files'} skipped
                  </span>
                )}
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
                {formatBytes(progress.bytesSent)} uploaded of {formatBytes(progress.bytesTotal)}
                {progress.bytesConfirmed > 0 &&
                  ` · ${formatBytes(progress.bytesConfirmed)} already on server`}
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
                        item.status === 'added' || item.status === 'confirmed'
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
                    {progress.confirmed > 0 && `, ${progress.confirmed} confirmed on server`}
                    {progress.duplicates > 0 && `, ${progress.duplicates} already here`}
                    {progress.failed > 0 && `, ${progress.failed} failed`}
                    {cancelledCount > 0 && `, ${cancelledCount} stopped`}
                  </p>

                  <Link
                    to="/settings?section=upload-history"
                    onClick={closeProgress}
                    className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                  >
                    View upload history →
                  </Link>

                  {(failedFileCount > 0 || progress.created > 0) && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {failedFileCount > 0 && (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<RotateCcw size={14} />}
                          onClick={() => {
                            const retryBatches = failedBatches;
                            setFailedBatches([]);
                            for (const batch of retryBatches) {
                              void uploadAll(
                                batch.files,
                                batch.destination,
                                batch.source,
                                true,
                              );
                            }
                          }}
                        >
                          Retry{' '}
                          {failedFileCount === 1
                            ? 'failed file'
                            : `${failedFileCount} failed files`}
                        </Button>
                      )}

                      {/* Photos are filed by the date they were taken, so an old scan
                          can land pages down and look like it never uploaded. */}
                      {progress.created > 0 && (
                        <Link
                          to="/?sort=added"
                          onClick={closeProgress}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          See what was just added →
                        </Link>
                      )}
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
