/** Fixed cell geometry prevents the selected thumbnail from moving its neighbours. */
export const FILMSTRIP_CELL_WIDTH = 44;
export const FILMSTRIP_THUMB_WIDTH = 36;
export const FILMSTRIP_THUMB_HEIGHT = 44;

export const filmstripPadding = (width: number) => Math.max(0, (width - FILMSTRIP_CELL_WIDTH) / 2);
export const filmstripOffset = (index: number) => Math.max(0, index) * FILMSTRIP_CELL_WIDTH;
export const filmstripInitialIndex = (current: number, width: number) =>
  Math.max(0, current - Math.ceil(width / FILMSTRIP_CELL_WIDTH / 2) - 1);
export const filmstripIndex = (offset: number, count: number) =>
  Math.max(0, Math.min(count - 1, Math.round(offset / FILMSTRIP_CELL_WIDTH)));

export const filmstripItemLayout = (width: number, index: number) => ({
  index,
  length: FILMSTRIP_CELL_WIDTH,
  offset: filmstripPadding(width) + filmstripOffset(index),
});
