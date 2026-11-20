import { describe, expect, it, vi } from 'vitest';
import { PageWindow } from './indexedCollection';
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const result = (page: number, total = 22_680) => ({ total, items: Array.from({ length: Math.max(0, Math.min(60, total - (page - 1) * 60)) }, (_, at) => ({ id: `photo-${(page - 1) * 60 + at}` })) });

describe('Random-access photo pages', () => {
  it('jumps to the last page without fetching or iterating preceding pages', async () => {
    const fetch = vi.fn(async (page: number) => result(page));
    const cache = new PageWindow(fetch);
    cache.loadRange(0, 10); await flush();
    fetch.mockClear();
    cache.loadRange(22_665, 22_680); await flush();
    expect(fetch.mock.calls.map(([page]) => page).sort()).toEqual([377, 378]);
    expect(cache.itemAt(22_679)?.id).toBe('photo-22679');
    expect(cache.itemAt(10_000)).toBeUndefined();
    expect(cache.total).toBe(22_680);
  });

  it('bounds the metadata cache while retaining explicitly selected records', async () => {
    const cache = new PageWindow(async page => result(page));
    cache.loadRange(0, 10); await flush();
    cache.retain(['photo-0']);
    for (let at = 1_000; at < 22_000; at += 1_000) { cache.loadRange(at, at + 30); await flush(); }
    expect(cache.pages.size).toBeLessThanOrEqual(6);
    expect(cache.items.length).toBeLessThanOrEqual(361);
    expect(cache.items.some(item => item.id === 'photo-0')).toBe(true);
  });

  it('aborts obsolete viewport requests and ignores their late results', async () => {
    const tasks = new Map<number, { signal: AbortSignal; done: (value: ReturnType<typeof result>) => void }>();
    const cache = new PageWindow((page, signal) => new Promise<ReturnType<typeof result>>(resolve => tasks.set(page, { signal, done: resolve })));
    cache.loadRange(0, 1);
    tasks.get(1)!.done(result(1)); await flush();
    const old = tasks.get(2)!;
    cache.loadRange(22_679, 22_680);
    expect(old.signal.aborted).toBe(true);
    expect(cache.pending.size).toBeLessThanOrEqual(2);
    tasks.get(378)!.done(result(378)); old.done(result(2)); await flush();
    expect(cache.itemAt(22_679)?.id).toBe('photo-22679');
    expect(cache.pages.has(2)).toBe(false);
    cache.dispose();
  });

  it('deduplicates repeated window requests and does not retry failures on every scroll frame', async () => {
    const fetch = vi.fn(async () => { throw new Error('Offline'); });
    const cache = new PageWindow(fetch);
    for (let i = 0; i < 100; i++) cache.loadRange(0, 10);
    await flush();
    cache.loadRange(0, 10); await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.error).toBe('Offline');
    await cache.reload();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes the current distant window rather than downloading a prefix again', async () => {
    const fetch = vi.fn(async (page: number) => result(page));
    const cache = new PageWindow(fetch);
    cache.loadRange(0, 1); await flush();
    cache.loadRange(22_679, 22_680); await flush();
    fetch.mockClear();
    await cache.reload(); await flush();
    expect(fetch.mock.calls.map(([page]) => page).sort()).toEqual([377, 378]);
  });
  it('keeps a failed visible page error when an adjacent prefetch succeeds', async () => {
    const cache = new PageWindow(async page => {
      if (page === 378) throw new Error('Last page unavailable');
      return result(page);
    });
    cache.loadRange(0, 1); await flush();
    cache.loadRange(22679, 22680); await flush();
    expect(cache.error).toBe('Last page unavailable');
    cache.loadRange(0, 1); await flush();
    expect(cache.error).toBeNull();
  });

});
