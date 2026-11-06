import type { Device } from './api';
/** /devices returns the complete device set, so this ordering is global. */
export function sortDevices(devices: readonly Device[], sort: 'date' | 'name' | 'type', order: 'asc' | 'desc'): Device[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...devices].sort((a, b) => {
    const primary = sort === 'date'
      ? (Date.parse(a.lastSeenAt) || 0) - (Date.parse(b.lastSeenAt) || 0)
      : sort === 'type' ? a.platform.localeCompare(b.platform) : 0;
    return direction * (primary || a.libraryName.localeCompare(b.libraryName, undefined,
      { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id));
  });
}

export function sortDeviceAssets<T extends { id: string; type: string; originalFileName?: string }>(
  assets: readonly T[], order: 'asc' | 'desc',
): T[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...assets].sort((a, b) => direction * a.type.localeCompare(b.type) ||
    (a.originalFileName ?? '').localeCompare(b.originalFileName ?? '', undefined,
      { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

/** Read every page before globally grouping by type; never sort a partial page. */
export async function readDeviceAssetIndex<T extends { id: string }>(
  fetchPage: (page: number) => Promise<{ items: T[]; pagination?: { page: number; size: number; total: number } }>,
  isCurrent: () => boolean,
): Promise<T[] | null> {
  const assets = new Map<string, T>();
  for (let page = 1; isCurrent(); page++) {
    const result = await fetchPage(page);
    if (!isCurrent()) return null;
    result.items.forEach(item => assets.set(item.id, item));
    if (!result.pagination || page * result.pagination.size >= result.pagination.total) return [...assets.values()];
    if (result.items.length === 0) throw new Error('The device library changed while loading. Pull to refresh.');
  }
  return null;
}
