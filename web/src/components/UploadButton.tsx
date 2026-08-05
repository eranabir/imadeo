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

/**
 * Uploads files or a whole directory.
 *
 * A directory gives every file a `webkitRelativePath`, which is forwarded so
 * the server rebuilds the same folder structure. Whatever folder or album the
 * person is looking at becomes the destination.
 */
export function UploadButton({
  compact = false,
  onError,
}: {
  compact?: boolean;
  onError?: (message: string) => void;
}) {
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const params = useParams();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * Opt-in, because the common case is repeating a backup and expecting it not
   * to double everything. Ticking this is how you say "yes, I mean it".
   */
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  /** Files the server already had, kept so they can be sent again on request. */
  const [skippedFiles, setSkippedFiles] = useState<File[]>([]);
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

  const uploadAll = async (fileList: FileList | File[] | null, forceDuplicate = false) => {
    if (!fileList || fileList.length === 0) return;

    const files = [...fileList];
    const bytesTotal = files.reduce((sum, file) => sum + file.size, 0);
    cancelled.current = false;

    let created = 0;
    let duplicates = 0;
    let failed = 0;
    let bytesDone = 0;

    // Held so the finished panel can offer to send the skipped ones again as
    // deliberate copies — far easier to find than a checkbox you have to know
    // about before you start.
    const skipped: File[] = [];

    for (const [index, file] of files.entries()) {
      if (cancelled.current) break;

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

      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      if (relative) form.append('relativePath', relative);

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
          skipped.push(file);
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
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => pick('files')}
            className={
              compact
                ? 'flex h-10 items-center gap-2 rounded-l-full bg-accent pl-4 pr-3 text-sm font-medium text-white transition hover:bg-accent-hover'
                : 'flex h-10 w-full items-center justify-center gap-2 rounded-l-full bg-accent px-4 text-sm font-medium text-white transition hover:bg-accent-hover'
            }
          >
            <Upload size={16} />
            Upload
          </button>
          {/* aria-label alone is invisible to sighted people, so the only
              control here without its own text label gets a real tooltip. */}
          <Tooltip label="Upload options">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Upload options"
              className="grid h-10 w-8 place-items-center rounded-r-full bg-accent pr-1 text-white transition hover:bg-accent-hover"
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
              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-600 transition-[width]"
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
                  className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline"
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
                      className="rounded-control bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover"
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
