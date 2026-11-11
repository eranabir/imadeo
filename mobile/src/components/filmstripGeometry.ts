/** Fixed cells keep the strip steady while selection changes. */
export const FILMSTRIP_CELL_WIDTH = 44;
export const FILMSTRIP_THUMB_WIDTH = 36;
export const FILMSTRIP_THUMB_HEIGHT = 44;
export const FILMSTRIP_EDGE_GUTTER = 8;

/** Fit complete thumbnail cells between equal gutters, including at fractional widths. */
export function filmstripViewportWidth(availableWidth: number, count: number) {
  const available = Math.max(0, availableWidth);
  const cells = Math.min(Math.max(0, count),
    Math.max(1, Math.floor((available - 2 * FILMSTRIP_EDGE_GUTTER) / FILMSTRIP_CELL_WIDTH)));
  return Math.min(available, cells * FILMSTRIP_CELL_WIDTH + 2 * FILMSTRIP_EDGE_GUTTER);
}

export const filmstripPadding = () => FILMSTRIP_EDGE_GUTTER;
export const filmstripMaxOffset = (width: number, count: number) =>
  Math.max(0, count * FILMSTRIP_CELL_WIDTH + 2 * FILMSTRIP_EDGE_GUTTER - width);

/** Settle between cells without changing which photo is selected. */
export function filmstripSnapOffset(offset: number, width: number, count: number) {
  return Math.max(0, Math.min(filmstripMaxOffset(width, count),
    Math.round(offset / FILMSTRIP_CELL_WIDTH) * FILMSTRIP_CELL_WIDTH));
}

/** Move only enough to reveal selection, and never scroll past either edge. */
export function filmstripOffset(index: number, width: number, count: number, offset = 0) {
  const max = filmstripMaxOffset(width, count);
  const current = Math.max(0, Math.min(max, offset));
  const item = Math.max(0, Math.min(count - 1, index));
  const left = FILMSTRIP_EDGE_GUTTER + item * FILMSTRIP_CELL_WIDTH;
  const right = left + FILMSTRIP_CELL_WIDTH;
  if (left < current + FILMSTRIP_EDGE_GUTTER) return Math.max(0, left - FILMSTRIP_EDGE_GUTTER);
  if (right > current + width - FILMSTRIP_EDGE_GUTTER) return Math.min(max, right + FILMSTRIP_EDGE_GUTTER - width);
  return current;
}

/** Render the visible preceding cells immediately when opening a distant item. */
export const filmstripInitialIndex = (current: number, width: number, count: number) =>
  Math.max(0, Math.floor((filmstripOffset(current, width, count) - FILMSTRIP_EDGE_GUTTER) / FILMSTRIP_CELL_WIDTH) - 1);

/** Keep the selected item's position under the finger, including both ends. */
export function filmstripIndex(offset: number, count: number, anchor: number) {
  return Math.max(0, Math.min(count - 1,
    Math.round((offset + anchor - FILMSTRIP_EDGE_GUTTER - FILMSTRIP_CELL_WIDTH / 2) / FILMSTRIP_CELL_WIDTH)));
}

export const filmstripItemLayout = (index: number) => ({
  index,
  length: FILMSTRIP_CELL_WIDTH,
  offset: FILMSTRIP_EDGE_GUTTER + Math.max(0, index) * FILMSTRIP_CELL_WIDTH,
});
