import { describe, expect, it } from 'vitest';
import { splitFileName } from './useLibraryActions';

describe('splitFileName', () => {
  it('separates the final extension while preserving dots in the base name', () => {
    expect(splitFileName('Trip.final.MOV')).toEqual({ base: 'Trip.final', extension: '.MOV' });
  });

  it('does not treat hidden or extensionless names as extensions', () => {
    expect(splitFileName('.portrait')).toEqual({ base: '.portrait', extension: '' });
    expect(splitFileName('portrait')).toEqual({ base: 'portrait', extension: '' });
  });
});
