import { describe, expect, it } from 'vitest';
import { photoColumns } from './layout';
describe('photo grid resizing', () => {
  it('adapts from a folded phone to the inner display and back', () => {
    expect([360, 840, 360].map(photoColumns)).toEqual([3, 7, 3]);
  });
  it('bounds columns in narrow and very wide windows', () => {
    expect(photoColumns(240)).toBe(2);
    expect(photoColumns(1800)).toBe(8);
  });
});
