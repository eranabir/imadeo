import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessingSignalService } from './processing-signal.service';

describe('ProcessingSignalService', () => {
  const uploads = new Map<string, number>();
  const values = new Map<string, { value: string; expiresAt: number | null }>();
  const redis = {
    zadd: vi.fn(async (_key: string, score: number, member: string) => {
      uploads.set(member, Number(score));
      return 1;
    }),
    zremrangebyscore: vi.fn(async (_key: string, _min: string, max: number) => {
      let removed = 0;
      for (const [member, score] of uploads) {
        if (score <= Number(max)) {
          uploads.delete(member);
          removed++;
        }
      }
      return removed;
    }),
    zcard: vi.fn(async () => uploads.size),
    zrem: vi.fn(async (_key: string, member: string) => Number(uploads.delete(member))),
    set: vi.fn(async (key: string, value: string, mode?: string, ttl?: number) => {
      values.set(key, {
        value,
        expiresAt: mode === 'PX' && ttl ? Date.now() + ttl : null,
      });
      return 'OK';
    }),
    get: vi.fn(async (key: string) => {
      const entry = values.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        values.delete(key);
        return null;
      }
      return entry.value;
    }),
    del: vi.fn(async (...keys: string[]) => {
      let removed = 0;
      for (const key of keys) removed += Number(values.delete(key));
      return removed;
    }),
    pipeline: vi.fn(() => {
      const writes: [string, string, string?, number?][] = [];
      return {
        set(key: string, value: string, mode?: string, ttl?: number) {
          writes.push([key, value, mode, ttl]);
          return this;
        },
        async exec() {
          for (const [key, value, mode, ttl] of writes) {
            await redis.set(key, value, mode, ttl);
          }
          return writes.map(() => [null, 'OK']);
        },
      };
    }),
  };

  const createService = () =>
    new ProcessingSignalService(
      { client: Promise.resolve(redis) } as never,
      {
        get: vi.fn((key: string) => {
          if (key === 'jobs.uploadIdleMs') return 1_000;
          if (key === 'jobs.userIdleMs') return 2_000;
          return 0;
        }),
      } as never,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    uploads.clear();
    values.clear();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('keeps overlapping uploads distinct and releases each after its quiet window', async () => {
    const service = createService();
    const finishFirst = service.beginUpload();
    const finishSecond = service.beginUpload();
    await vi.advanceTimersByTimeAsync(0);
    await expect(service.activeUploadCount()).resolves.toBe(2);

    finishFirst();
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(service.activeUploadCount()).resolves.toBe(1);

    finishSecond();
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(service.activeUploadCount()).resolves.toBe(0);
    service.onModuleDestroy();
  });

  it('expires foreground activity instead of pausing processing forever', async () => {
    const service = createService();
    service.noteUserActivity();
    await vi.advanceTimersByTimeAsync(0);
    await expect(service.backgroundWindowIsOpen()).resolves.toBe(false);

    await vi.advanceTimersByTimeAsync(2_001);
    await expect(service.backgroundWindowIsOpen()).resolves.toBe(true);
  });

  it('blocks a stale upload receipt until its asset is explicitly restored', async () => {
    const service = createService();
    await service.cancelUploadReceipts('owner-id', ['upload-id']);
    await expect(service.uploadReceiptIsCancelled('owner-id', 'upload-id')).resolves.toBe(true);

    await service.clearCancelledUploadReceipts('owner-id', ['upload-id']);
    await expect(service.uploadReceiptIsCancelled('owner-id', 'upload-id')).resolves.toBe(false);
  });
});
