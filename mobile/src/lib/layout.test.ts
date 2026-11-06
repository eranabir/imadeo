import { describe, expect, it } from 'vitest';
import { photoColumns, regularIPhoneHeaderHeight, usesRegularIPhoneHeader } from './layout';
describe('photo grid resizing', () => {
  it('adapts from a folded phone to the inner display and back', () => {
    expect([360, 840, 360].map(photoColumns)).toEqual([3, 7, 3]);
  });
  it('bounds columns in narrow and very wide windows', () => {
    expect(photoColumns(240)).toBe(2);
    expect(photoColumns(1800)).toBe(8);
  });
});

describe('regular iPhone header classification', () => {
  it('recognises iPhone 17 Pro Max independently of window dimensions', () => {
    expect(usesRegularIPhoneHeader('iPhone18,2')).toBe(true);
    expect(usesRegularIPhoneHeader('iPhone19,2')).toBe(true);
    expect(usesRegularIPhoneHeader('iPhone19,3')).toBe(true);
  });
  it('keeps the Duo layout in every posture and preserves unknown devices', () => {
    for (const identifier of ['iPhone19,4', 'iPad17,1', 'arm64', 'iPhone99,1', null, undefined]) {
      expect(usesRegularIPhoneHeader(identifier)).toBe(false);
    }
  });
  it('reserves the same title area for compact landscape and initial header measurements', () => {
    expect(regularIPhoneHeaderHeight(110, 62)).toBe(110);
    expect(regularIPhoneHeaderHeight(32, 0)).toBe(44);
    expect(regularIPhoneHeaderHeight(0, 62)).toBe(106);
  });
});
