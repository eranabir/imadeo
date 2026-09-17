import { describe, expect, it } from 'vitest';
import { videoSeekPosition } from './videoSeekPosition';

describe('video seek coordinates', () => {
  it('tracks movement in both directions without using the moving thumb origin', () => {
    expect([200, 250, 150, 200].map(x => videoSeekPosition(x, 100, 200, 60))).toEqual([30, 45, 15, 30]);
  });
  it('keeps the same position across repeated taps and drags', () => {
    expect(videoSeekPosition(250, 100, 200, 60)).toBe(45);
    expect(videoSeekPosition(250, 100, 200, 60)).toBe(45);
  });
  it('clamps fingers outside either end of the track', () => {
    expect(videoSeekPosition(0, 100, 200, 60)).toBe(0);
    expect(videoSeekPosition(500, 100, 200, 60)).toBe(60);
  });
  it('does not seek before metadata or layout is ready', () => {
    expect(videoSeekPosition(200, 100, 0, 60)).toBeNull();
    expect(videoSeekPosition(200, 100, 200, 0)).toBeNull();
    expect(videoSeekPosition(NaN, 100, 200, 60)).toBeNull();
  });
});
