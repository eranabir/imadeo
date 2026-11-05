/** Keep photo cells near phone size as the current window folds or resizes. */
export function photoColumns(width: number): number {
  return Math.max(2, Math.min(8, Math.floor(width / 120)));
}
