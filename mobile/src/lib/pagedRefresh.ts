export interface Page<T> {
  items: T[];
  pagination?: { page: number; size: number; total: number; pages?: number };
}

/** Revalidate all visible pages atomically; never collapse a scrolled list to page one. */
export async function refreshPages<T>(
  count: number,
  fetchPage: (page: number) => Promise<Page<T>>,
): Promise<Page<T>> {
  const items: T[] = [];
  let pagination: Page<T>['pagination'];
  for (let page = 1; page <= Math.max(1, count); page++) {
    const result = await fetchPage(page);
    items.push(...result.items);
    pagination = result.pagination;
    if (!pagination || page * pagination.size >= pagination.total) break;
  }
  return { items, pagination };
}
