/** Advance to the following item, or the preceding one when deleting the last.
 * An empty result is the only successful deletion that should close a viewer. */
export function withoutViewerItem<T extends { id: string }>(items: T[], index: number, id: string) {
  const currentId = items[index]?.id;
  const remaining = items.filter((item) => item.id !== id);
  const preserved = remaining.findIndex((item) => item.id === currentId);
  return { items: remaining, index: preserved >= 0 ? preserved : Math.max(0, Math.min(index, remaining.length - 1)) };
}
