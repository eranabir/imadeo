import { useSyncExternalStore } from 'react';

export type UploadStatus =
  | 'queued'
  | 'uploading'
  | 'added'
  | 'confirmed'
  | 'duplicate'
  | 'failed'
  | 'cancelled';

export type UploadSource = 'files' | 'folder' | 'drop' | 'retry';

export interface UploadDestination {
  folderId?: string;
  albumId?: string;
  label: string;
  path: string;
}

export interface UploadHistoryItem {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  error?: string;
}

export interface UploadHistorySummary {
  total: number;
  added: number;
  duplicates: number;
  failed: number;
  cancelled: number;
  bytesTotal: number;
}

export interface UploadHistoryEntry {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: 'uploading' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
  source: UploadSource;
  destination: UploadDestination;
  items: UploadHistoryItem[];
  summary: UploadHistorySummary;
  /** Successful rows may be compacted if browser storage is nearly full. */
  omittedItems?: number;
}

export interface UploadCandidate {
  file: File;
  relativePath?: string;
  /** Stable receipt reused when an uncertain upload is retried. */
  uploadId?: string;
}

export interface UploadRetryRequest {
  files: UploadCandidate[];
  destination: UploadDestination;
  source: UploadSource;
  confirmBeforeRetry?: boolean;
}

const STORAGE_PREFIX = 'imadeo.upload-history.v1.';
const RETRY_EVENT = 'imadeo:retry-upload';
const MAX_ENTRIES = 25;
const EMPTY: UploadHistoryEntry[] = [];
const cache = new Map<string, UploadHistoryEntry[]>();
const listeners = new Map<string, Set<() => void>>();
const rememberedFiles = new Map<string, Map<string, UploadCandidate>>();
const pendingWrites = new Map<string, number>();
let idSequence = 0;

const storageKey = (userId: string) => `${STORAGE_PREFIX}${userId}`;

/** Works on plain HTTP LAN installs where Web Crypto UUIDs are unavailable. */
export const createUploadHistoryId = () =>
  `${Date.now().toString(36)}-${(idSequence++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function summaryFor(items: UploadHistoryItem[]): UploadHistorySummary {
  return {
    total: items.length,
    added: items.filter((item) => item.status === 'added' || item.status === 'confirmed').length,
    duplicates: items.filter((item) => item.status === 'duplicate').length,
    failed: items.filter((item) => item.status === 'failed').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length,
    bytesTotal: items.reduce((sum, item) => sum + item.size, 0),
  };
}

function notify(userId: string) {
  for (const listener of listeners.get(userId) ?? []) listener();
}

function writeStorage(userId: string, entries: UploadHistoryEntry[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(entries));
  } catch {
    // Names and failures matter most. If the browser quota is tight, retain all
    // problem rows and only a small sample of successful rows.
    const compact = entries.map((entry) => {
      const problems = entry.items.filter(
        (item) => item.status === 'failed' || item.status === 'cancelled',
      );
      const successes = entry.items
        .filter(
          (item) =>
            item.status === 'added' || item.status === 'confirmed' || item.status === 'duplicate',
        )
        .slice(0, 50);
      const pending = entry.items.filter(
        (item) => item.status === 'queued' || item.status === 'uploading',
      );
      const items = [...problems, ...pending, ...successes];
      return {
        ...entry,
        items,
        omittedItems: Math.max(0, entry.summary.total - items.length),
      };
    });
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(compact.slice(0, 10)));
    } catch {
      // Uploading must never fail because optional local history cannot be saved.
    }
  }
}

function load(userId: string): UploadHistoryEntry[] {
  const existing = cache.get(userId);
  if (existing) return existing;

  let entries: UploadHistoryEntry[] = [];
  try {
    entries = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '[]');
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }

  let changed = false;
  entries = entries.map((entry) => {
    if (entry.status !== 'uploading') return entry;
    changed = true;
    const items = entry.items.map((item) =>
      item.status === 'queued' || item.status === 'uploading'
        ? {
            ...item,
            status: 'failed' as const,
            error: 'The page closed before this upload finished.',
          }
        : item,
    );
    return {
      ...entry,
      status: 'interrupted' as const,
      finishedAt: entry.finishedAt ?? new Date().toISOString(),
      items,
      summary: summaryFor(items),
    };
  });

  cache.set(userId, entries);
  if (changed) writeStorage(userId, entries);
  return entries;
}

function replace(userId: string, entries: UploadHistoryEntry[], immediate = true) {
  const previous = cache.get(userId) ?? [];
  const next = entries.slice(0, MAX_ENTRIES);
  const retainedIds = new Set(next.map((entry) => entry.id));
  for (const entry of previous) {
    if (!retainedIds.has(entry.id)) rememberedFiles.delete(entry.id);
  }
  cache.set(userId, next);
  const pending = pendingWrites.get(userId);
  if (immediate) {
    if (pending) window.clearTimeout(pending);
    pendingWrites.delete(userId);
    writeStorage(userId, next);
  } else if (!pending) {
    pendingWrites.set(
      userId,
      window.setTimeout(() => {
        pendingWrites.delete(userId);
        writeStorage(userId, cache.get(userId) ?? []);
      }, 300),
    );
  }
  notify(userId);
}

export function useUploadHistory(userId?: string) {
  return useSyncExternalStore(
    (listener) => {
      if (!userId) return () => undefined;
      const group = listeners.get(userId) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(userId, group);
      return () => {
        group.delete(listener);
        if (group.size === 0) listeners.delete(userId);
      };
    },
    () => (userId ? load(userId) : EMPTY),
    () => EMPTY,
  );
}

export function beginUploadHistory(
  userId: string,
  source: UploadSource,
  destination: UploadDestination,
  items: UploadHistoryItem[],
) {
  const id = createUploadHistoryId();
  const entry: UploadHistoryEntry = {
    id,
    startedAt: new Date().toISOString(),
    status: 'uploading',
    source,
    destination,
    items,
    summary: summaryFor(items),
  };
  replace(userId, [entry, ...load(userId)]);
  return id;
}

export function updateUploadHistoryItem(
  userId: string,
  entryId: string,
  item: UploadHistoryItem,
) {
  replace(
    userId,
    load(userId).map((entry) => {
      if (entry.id !== entryId) return entry;
      const items = entry.items.map((existing) => (existing.id === item.id ? item : existing));
      return { ...entry, items, summary: summaryFor(items) };
    }),
    false,
  );
}

export function finishUploadHistory(
  userId: string,
  entryId: string,
  items: UploadHistoryItem[],
) {
  const summary = summaryFor(items);
  const status =
    summary.failed > 0
      ? 'failed'
      : summary.cancelled > 0
        ? 'cancelled'
        : 'complete';
  const files = rememberedFiles.get(entryId);
  if (files) {
    const retryIds = new Set(
      items
        .filter((item) => item.status === 'failed' || item.status === 'cancelled')
        .map((item) => item.id),
    );
    for (const itemId of files.keys()) {
      if (!retryIds.has(itemId)) files.delete(itemId);
    }
    if (files.size === 0) rememberedFiles.delete(entryId);
  }
  replace(
    userId,
    load(userId).map((entry) =>
      entry.id === entryId
        ? { ...entry, status, finishedAt: new Date().toISOString(), items, summary }
        : entry,
    ),
  );
}

export function rememberUploadFiles(entryId: string, items: UploadHistoryItem[], files: UploadCandidate[]) {
  rememberedFiles.set(
    entryId,
    new Map(items.map((item, index) => [item.id, files[index]])),
  );
}

export function retryableUploadFiles(entry: UploadHistoryEntry) {
  const files = rememberedFiles.get(entry.id);
  if (!files) return [];
  return entry.items
    .filter((item) => item.status === 'failed' || item.status === 'cancelled')
    .map((item) => files.get(item.id))
    .filter((candidate): candidate is UploadCandidate => Boolean(candidate));
}

export function removeUploadHistory(userId: string, entryId: string) {
  rememberedFiles.delete(entryId);
  replace(userId, load(userId).filter((entry) => entry.id !== entryId));
}

export function clearUploadHistory(userId: string) {
  for (const entry of load(userId)) rememberedFiles.delete(entry.id);
  replace(userId, []);
}

export function requestUploadRetry(request: UploadRetryRequest) {
  window.dispatchEvent(new CustomEvent<UploadRetryRequest>(RETRY_EVENT, { detail: request }));
}

export function listenForUploadRetry(listener: (request: UploadRetryRequest) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<UploadRetryRequest>).detail);
  window.addEventListener(RETRY_EVENT, handler);
  return () => window.removeEventListener(RETRY_EVENT, handler);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key?.startsWith(STORAGE_PREFIX)) return;
    const userId = event.key.slice(STORAGE_PREFIX.length);
    cache.delete(userId);
    notify(userId);
  });
}
