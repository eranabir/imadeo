import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FolderUp, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatBytes } from '../lib/format';
import { Checkbox, Tooltip } from '../ui';

interface Progress {
  total: number;
  done: number;
  created: number;
  duplicates: number;
  failed: number;
  currentName: string;
  /** 0-1 for the file in flight, from real upload bytes. */
  currentFraction: number;
  bytesSent: number;
  bytesTotal: number;
}

interface UploadCandidate {
  file: File;
  /** Path inside a folder dropped from Finder or Explorer. */
  relativePath?: string;
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

const isMedia = (file: File) =>
  file.type.startsWith('image/') ||
  file.type.startsWith('video/') ||
  /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp|3gp|avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i.test(
    file.name,
  );

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

async function filesFromDrop(dataTransfer: DataTransfer) {
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
  const params = useParams();
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
  const cancelled = useRef(false);
  const controller = useRef<AbortController | null>(null);

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
    cancelled.current = false;

    let created = 0;
    let duplicates = 0;
    let failed = 0;
    let bytesDone = 0;

    // Held so the finished panel can offer to send the skipped ones again as
    // deliberate copies — far easier to find than a checkbox you have to know
    // about before you start.
    const skipped: UploadCandidate[] = [];

    for (const [index, candidate] of files.entries()) {
      if (cancelled.current) break;
      const { file, relativePath } = candidate;

      const base: Progress = {
        total: files.length,
        done: index,
        created,
        duplicates,
        failed,
        currentName: file.name,
        currentFraction: 0,
        bytesSent: bytesDone,
        bytesTotal,
      };
      setProgress(base);

      const form = new FormData();
      form.append('assetData', file);
      form.append('fileCreatedAt', new Date(file.lastModified).toISOString());
      form.append('fileModifiedAt', new Date(file.lastModified).toISOString());

      if (relativePath) form.append('relativePath', relativePath);

      // Whatever is on screen is the destination.
      if (params.folderId) form.append('folderId', params.folderId);
      if (params.albumId) form.append('albumId', params.albumId);

      if (allowDuplicate || forceDuplicate) form.append('allowDuplicate', 'true');

      controller.current = new AbortController();

      try {
        const { data } = await api.post('/assets/upload', form, {
          signal: controller.current.signal,
          // A multi-gigabyte video must not be cut off by a client timeout.
          timeout: 0,
          onUploadProgress: (event) => {
            const fraction = event.total ? event.loaded / event.total : 0;
            setProgress({
              ...base,
              currentFraction: fraction,
              bytesSent: bytesDone + event.loaded,
            });
          },
        });

        if (data.status === 'duplicate') {
          duplicates += 1;
          skipped.push(candidate);
        } else created += 1;
      } catch (error) {
        if (!cancelled.current) {
          failed += 1;
          onError?.(`${file.name}: ${errorMessage(error)}`);
        }
      }

      bytesDone += file.size;
    }

    setProgress({
      total: files.length,
      done: files.length,
      created,
      duplicates,
      failed,
      currentName: '',
      currentFraction: 1,
      bytesSent: bytesTotal,
      bytesTotal,
    });

    setSkippedFiles(skipped);
    await queryClient.invalidateQueries();

    // Leave the summary up briefly so the counts stay readable — but not when
    // something was skipped, because that panel is now asking a question.
    if (skipped.length === 0) setTimeout(() => setProgress(null), 3500);
  };

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
          return uploadAll(files);
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
    ? progress.bytesTotal > 0
      ? (progress.bytesSent / progress.bytesTotal) * 100
      : (progress.done / progress.total) * 100
    : 0;

  const running = progress !== null && progress.done < progress.total;

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
          void uploadAll(event.target.files);
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
          void uploadAll(event.target.files);
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
        <div className="pop-in fixed bottom-6 right-6 z-50 w-[22rem] rounded-panel border border-border-subtle bg-surface-overlay p-4 shadow-popover">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {running
                ? `Uploading ${progress.done + 1} of ${progress.total}`
                : progress.failed > 0
                  ? 'Upload finished with errors'
                  : 'Upload complete'}
            </span>
            {running && (
              <Tooltip label="Stop">
              <button
                type="button"
                onClick={() => {
                  cancelled.current = true;
                  controller.current?.abort();
                }}
                className="grid h-6 w-6 place-items-center rounded-full hover:bg-surface-sunken"
              >
                <X size={13} />
              </button>
              </Tooltip>
            )}
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-gradient-to-r from-secondary to-primary-deep transition-[width]"
              style={{ width: `${overall}%` }}
            />
          </div>

          {running && (
            <>
              <p className="mt-2 truncate text-xs text-content-muted">{progress.currentName}</p>
              <p className="mt-0.5 text-[11px] tabular-nums text-content-muted">
                {formatBytes(progress.bytesSent)} of {formatBytes(progress.bytesTotal)}
                {progress.currentFraction > 0 &&
                  ` · this file ${Math.round(progress.currentFraction * 100)}%`}
              </p>
            </>
          )}

          {!running && (
            <>
              <p className="mt-2 text-xs text-content-muted">
                {progress.created} added
                {progress.duplicates > 0 && `, ${progress.duplicates} already here`}
                {progress.failed > 0 && `, ${progress.failed} failed`}
              </p>

              {/* Photos are filed by the date they were taken, so an old scan
                  can land pages down and look like it never uploaded. This is
                  the shortcut to what actually just arrived. */}
              {progress.created > 0 && (
                <Link
                  to="/?sort=added"
                  onClick={() => setProgress(null)}
                  className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline"
                >
                  See what was just added →
                </Link>
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
                        void uploadAll(again, true);
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
        </div>,
          document.body,
        )}
    </>
  );
}
