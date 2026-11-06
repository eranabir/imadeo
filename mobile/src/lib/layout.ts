/** Keep photo cells near phone size as the current window folds or resizes. */
export function photoColumns(width: number): number {
  return Math.max(2, Math.min(8, Math.floor(width / 120)));
}

/** Known flat iPhones only; Duo and unrecognised hardware keep the existing layout. */
export function usesRegularIPhoneHeader(modelIdentifier: string | null | undefined): boolean {
  const model = /^iPhone(\d+),(\d+)$/.exec(modelIdentifier ?? '');
  return Boolean(model && ((Number(model[1]) >= 1 && Number(model[1]) <= 18) ||
    modelIdentifier === 'iPhone19,2' || modelIdentifier === 'iPhone19,3'));
}

/** Compact landscape navigation bars can be shorter than the title/subtitle pair. */
export function regularIPhoneHeaderHeight(nativeHeight: number, topInset: number): number {
  return Math.max(nativeHeight, topInset + 44);
}
