/** Container sections already group by type; use names within each type. */
export function sortContainers<T extends { id: string; name: string; createdAt?: string }>(
  items: readonly T[], sort: 'date' | 'name' | 'type', order: 'asc' | 'desc',
): T[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const date = sort === 'date'
      ? (Date.parse(a.createdAt ?? '') || 0) - (Date.parse(b.createdAt ?? '') || 0)
      : 0;
    return direction * (date || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id));
  });
}
