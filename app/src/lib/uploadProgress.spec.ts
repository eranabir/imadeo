import { describe, expect, it } from 'vitest';
import { combineUploadProgress, type UploadProgress } from './uploadProgress';

function progress(
  id: string,
  overrides: Partial<Omit<UploadProgress, 'items'>> = {},
): UploadProgress {
  return {
    total: 1,
    ignored: 0,
    done: 0,
    created: 0,
    confirmed: 0,
    duplicates: 0,
    failed: 0,
    bytesSent: 0,
    bytesConfirmed: 0,
    bytesTotal: 100,
    items: [{ id, name: `${id}.jpg`, size: 100, status: 'queued', fraction: 0 }],
    ...overrides,
  };
}

describe('combined upload progress', () => {
  it('keeps an earlier running batch visible when another drop is added', () => {
    const newest = progress('second', { bytesSent: 25 });
    const earlier = progress('first', { done: 1, created: 1, bytesSent: 100 });

    const combined = combineUploadProgress([newest, earlier]);

    expect(combined).toMatchObject({
      total: 2,
      done: 1,
      created: 1,
      bytesSent: 125,
      bytesTotal: 200,
    });
    expect(combined?.items.map((item) => item.id)).toEqual(['second', 'first']);
  });

  it('combines unsupported, confirmed, duplicate, and failed counts', () => {
    const combined = combineUploadProgress([
      progress('one', { ignored: 2, done: 1, confirmed: 1, bytesConfirmed: 100 }),
      progress('two', { done: 1, duplicates: 1, failed: 1 }),
    ]);

    expect(combined).toMatchObject({
      ignored: 2,
      done: 2,
      confirmed: 1,
      duplicates: 1,
      failed: 1,
      bytesConfirmed: 100,
    });
  });
});

