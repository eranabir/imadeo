import type { UploadStatus } from './uploadHistory';

export interface UploadProgressItem {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0-1 for the file in flight, from real upload bytes. */
  fraction: number;
  error?: string;
}

export interface UploadProgress {
  total: number;
  ignored: number;
  done: number;
  created: number;
  confirmed: number;
  duplicates: number;
  failed: number;
  bytesSent: number;
  bytesConfirmed: number;
  bytesTotal: number;
  items: UploadProgressItem[];
}

/** Combines concurrent upload batches into the one panel shown to the user. */
export function combineUploadProgress(runs: readonly UploadProgress[]): UploadProgress | null {
  if (runs.length === 0) return null;

  return runs.reduce<UploadProgress>(
    (combined, run) => ({
      total: combined.total + run.total,
      ignored: combined.ignored + run.ignored,
      done: combined.done + run.done,
      created: combined.created + run.created,
      confirmed: combined.confirmed + run.confirmed,
      duplicates: combined.duplicates + run.duplicates,
      failed: combined.failed + run.failed,
      bytesSent: combined.bytesSent + run.bytesSent,
      bytesConfirmed: combined.bytesConfirmed + run.bytesConfirmed,
      bytesTotal: combined.bytesTotal + run.bytesTotal,
      items: [...combined.items, ...run.items],
    }),
    {
      total: 0,
      ignored: 0,
      done: 0,
      created: 0,
      confirmed: 0,
      duplicates: 0,
      failed: 0,
      bytesSent: 0,
      bytesConfirmed: 0,
      bytesTotal: 0,
      items: [],
    },
  );
}

