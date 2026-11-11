import { describe, expect, it } from 'vitest';
import { viewerChromeFrame, viewerRailFrame } from './viewerGeometry';

describe('Viewer side rail', () => {
  it.each([72, 88, 104])('aligns controls with the system column in a %spt Duo inset', right => {
    const frame = viewerRailFrame(440, 636, { top: 0, left: 0, right }, 12);
    expect(frame.right + frame.width / 2).toBe(right / 2 + 4);
    expect(frame.top).toBeGreaterThanOrEqual(136);
    expect(frame.top + frame.height).toBe(636 - 12 - 12);
  });

  it.each([
    { width: 320, height: 568, top: 20, left: 0, right: 0 },
    { width: 402, height: 874, top: 62, left: 0, right: 0 },
    { width: 874, height: 402, top: 0, left: 62, right: 62 },
    { width: 1024, height: 1366, top: 24, left: 0, right: 0 },
  ])('keeps the rail and thumbnail strip separate at $width × $height', ({ width, height, ...insets }) => {
    const rail = viewerRailFrame(width, height, insets, 12);
    const strip = viewerChromeFrame(width, insets.left, Math.max(insets.right, rail.right + rail.width));
    expect(rail.width).toBeGreaterThanOrEqual(44);
    expect(rail.right).toBeGreaterThanOrEqual(insets.right);
    expect(rail.top).toBeGreaterThanOrEqual(insets.top + 52 + 12);
    expect(rail.top + rail.height).toBeLessThanOrEqual(height - 12);
    expect(strip.left).toBeGreaterThanOrEqual(insets.left);
    expect(strip.left + strip.width).toBeLessThanOrEqual(width - rail.right - rail.width);
  });
});
