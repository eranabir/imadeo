import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AssetQueryDto } from './asset.dto';

describe('AssetQueryDto Favorites requests', () => {
  it.each(['asc', 'desc'])('accepts paged Type sorting %s from URL query strings', (order) => {
    const query = plainToInstance(AssetQueryDto, {
      isFavorite: 'true', sortBy: 'type', order, page: '2', size: '2',
    });

    expect(validateSync(query)).toEqual([]);
    expect(query).toMatchObject({ isFavorite: true, sortBy: 'type', order, page: 2, size: 2 });
  });

  it('still rejects an unknown sort field', () => {
    const query = plainToInstance(AssetQueryDto, { isFavorite: 'true', sortBy: 'unknown' });

    expect(validateSync(query).map(error => error.property)).toContain('sortBy');
  });
});
