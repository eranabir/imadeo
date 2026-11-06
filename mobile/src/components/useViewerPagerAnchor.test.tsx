import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = vi.hoisted(() => new Set<(state: string) => void>());
vi.mock('react-native', () => ({ AppState: {
  addEventListener: (_event: string, listener: (state: string) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
} }));
import { useViewerPagerAnchor } from './useViewerPagerAnchor';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
});
afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  listeners.clear();
});

async function render() {
  const scrollToOffset = vi.fn();
  const pager = { current: { scrollToOffset } };
  const index = { current: 3 };
  let guard!: { current: boolean };
  function Probe({ width }: { width: number }) {
    guard = useViewerPagerAnchor(pager, width, index);
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<Probe width={402} />); });
  mounted.push(tree);
  return { scrollToOffset, index, guard: () => guard, resize: async (width: number) => {
    await act(async () => tree.update(<Probe width={width} />));
  } };
}

describe('Viewer pager re-anchoring', () => {
  it('anchors the same index at the new width and guards stale momentum events', async () => {
    const view = await render();
    expect(view.scrollToOffset).not.toHaveBeenCalled();
    await view.resize(874);
    expect(view.guard().current).toBe(true);
    await act(async () => { vi.advanceTimersByTime(16); });
    expect(view.scrollToOffset).toHaveBeenLastCalledWith({ offset: 3 * 874, animated: false });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(view.guard().current).toBe(false);
    expect(view.index.current).toBe(3);
  });
  it('cancels stale resize work during a rapid Duo expansion and collapse', async () => {
    const view = await render();
    await view.resize(874);
    await view.resize(402);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(view.scrollToOffset).toHaveBeenCalledTimes(2);
    expect(view.scrollToOffset).toHaveBeenNthCalledWith(1, { offset: 3 * 402, animated: false });
    expect(view.scrollToOffset).toHaveBeenNthCalledWith(2, { offset: 3 * 402, animated: false });
  });
  it('lets a fresh user drag cancel the delayed anchor and still re-anchors on resume', async () => {
    const view = await render();
    await view.resize(874);
    await act(async () => { vi.advanceTimersByTime(16); });
    view.guard().current = false;
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(view.scrollToOffset).toHaveBeenCalledOnce();
    await act(async () => { for (const listener of listeners) listener('active'); });
    await act(async () => { vi.advanceTimersByTime(16); });
    expect(view.scrollToOffset).toHaveBeenCalledTimes(2);
    expect(view.guard().current).toBe(true);
  });
});
