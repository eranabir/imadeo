import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameScheduler } from './frameScheduler';

describe('frameScheduler', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };

  beforeEach(() => {
    frames.clear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('coalesces scroll bursts and reads the latest scroll position', () => {
    let scrollTop = 0;
    const update = vi.fn(() => scrollTop);
    const scheduler = frameScheduler(update);
    for (let i = 0; i < 100; i++) {
      scrollTop = i * 10;
      scheduler.schedule();
    }
    expect(update).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    flush();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveReturnedWith(990);
    scheduler.schedule();
    flush();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('cancels pending work when a grid unmounts or its layout changes', () => {
    const update = vi.fn();
    const scheduler = frameScheduler(update);
    scheduler.schedule();
    scheduler.cancel();
    flush();
    expect(update).not.toHaveBeenCalled();
    scheduler.schedule();
    flush();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
