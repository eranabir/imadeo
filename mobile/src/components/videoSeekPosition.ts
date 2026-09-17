/** Resolve every drag event against the same track, never the moving thumb. */
export function videoSeekPosition(pageX: number, trackLeft: number, width: number, duration: number): number | null {
  if (![pageX, trackLeft, width, duration].every(Number.isFinite) || width <= 0 || duration <= 0) return null;
  return Math.max(0, Math.min(duration, ((pageX - trackLeft) / width) * duration));
}
