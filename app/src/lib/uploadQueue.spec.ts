import { describe, expect, it } from 'vitest';
import { createUploadLimiter, runUploadQueue } from './uploadQueue';

describe('web upload queue', () => {
  it('processes hundreds of files exactly once with bounded concurrency', async () => {
    const items = Array.from({ length: 398 }, (_, index) => index);
    const visits = Array.from({ length: items.length }, () => 0);
    let active = 0;
    let maximumActive = 0;

    await runUploadQueue(items, 4, async (item, index) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, index % 3));
      visits[item] += 1;
      active -= 1;
    });

    expect(visits.every((count) => count === 1)).toBe(true);
    expect(maximumActive).toBe(4);
  });

  it('continues after per-file failures handled by the uploader', async () => {
    const completed: number[] = [];
    const failed: number[] = [];

    await runUploadQueue(Array.from({ length: 50 }, (_, index) => index), 4, async (item) => {
      try {
        if (item % 11 === 0) throw new Error('temporary failure');
        completed.push(item);
      } catch {
        failed.push(item);
      }
    });

    expect(completed).toHaveLength(45);
    expect(failed).toEqual([0, 11, 22, 33, 44]);
  });

  it('keeps the concurrency ceiling shared across batches added together', async () => {
    const limit = createUploadLimiter(4);
    let active = 0;
    let maximumActive = 0;
    const upload = () =>
      limit(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
      });

    await Promise.all([
      runUploadQueue(Array.from({ length: 20 }), 4, upload),
      runUploadQueue(Array.from({ length: 20 }), 4, upload),
    ]);

    expect(maximumActive).toBe(4);
  });
});
