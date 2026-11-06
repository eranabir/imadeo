import type * as MediaLibrary from 'expo-media-library/legacy';

type Sort = 'date' | 'name' | 'type';
type Page = MediaLibrary.PagedInfo<MediaLibrary.Asset>;
type FetchAssets = (options: MediaLibrary.AssetsOptions) => Promise<Page>;

/** Name is not a Photos sort key: build the complete metadata index first. */
export async function readLocalDevicePage(
  fetchAssets: FetchAssets, sort: Sort, order: 'asc' | 'desc', pageSize: number,
  after?: string, isCurrent: () => boolean = () => true,
  hiddenIDs: ReadonlySet<string> = new Set(),
): Promise<Page | null> {
  if (!isCurrent()) return null;
  const sortBy: MediaLibrary.SortByValue[] = sort === 'type'
    ? [['mediaType', order === 'asc'], ['creationTime', false]]
    : [['creationTime', sort === 'name' || order === 'asc']];
  const page = await fetchAssets({ first: sort === 'name' ? 1000 : pageSize,
    ...(after ? { after } : {}), mediaType: ['photo', 'video'], sortBy });
  if (!isCurrent()) return null;
  if (sort !== 'name') {
    let current = page;
    const cursors = new Set(after ? [after] : []);
    while (true) {
      const assets = current.assets.filter(asset => !hiddenIDs.has(asset.id));
      if (assets.length > 0 || !current.hasNextPage) return { ...current, assets };
      const cursor = current.endCursor;
      if (!cursor || cursors.has(cursor)) throw new Error('The photo library changed while loading. Pull to refresh.');
      cursors.add(cursor);
      current = await fetchAssets({ first: pageSize, after: cursor, mediaType: ['photo', 'video'], sortBy });
      if (!isCurrent()) return null;
    }
  }
  const all = new Map(page.assets.filter(asset => !hiddenIDs.has(asset.id)).map(asset => [asset.id, asset]));
  let current = page;
  while (current.hasNextPage && isCurrent()) {
    const cursor = current.endCursor;
    current = await fetchAssets({ first: 1000, after: cursor, mediaType: ['photo', 'video'], sortBy });
    if (!isCurrent()) return null;
    current.assets.filter(asset => !hiddenIDs.has(asset.id)).forEach(asset => all.set(asset.id, asset));
    if (current.hasNextPage && current.endCursor === cursor) throw new Error('The photo library changed while loading. Pull to refresh.');
  }
  const direction = order === 'asc' ? 1 : -1;
  const assets = [...all.values()].filter(asset => !hiddenIDs.has(asset.id)).sort((a, b) => direction *
    (a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id)));
  return { ...current, assets, hasNextPage: false };
}
