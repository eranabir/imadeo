import { describe, expect, it } from 'vitest';
import { mimeFor } from './media.controller';

describe('mimeFor', () => {
  it('uses the uploaded filename when a stored original has no extension', () => {
    expect(mimeFor('/data/users/id/library/asset', 'IMG_1234.MOV')).toBe('video/quicktime');
  });

  it('prefers the generated derivative extension', () => {
    expect(mimeFor('/data/users/id/encoded-video/asset.mp4', 'IMG_1234.MOV')).toBe('video/mp4');
  });
});
