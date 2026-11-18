import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fullScrollHeight, usePaginatedSeek } from './usePaginatedSeek';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });

describe('Seeking through paged photo metadata', () => {
  async function setup() {
    let props = { contentHeight: 10_000, loadedHeight: 2_000, viewportHeight: 500,
      loadedCount: 100, hasMore: true, loadingMore: false, onLoadMore: vi.fn(), scrollTo: vi.fn() };
    let current!: ReturnType<typeof usePaginatedSeek>;
    let renders = 0;
    function Host() { renders++; current = usePaginatedSeek(props); return null; }
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<Host />); });
    mounted.push(tree);
    return { get current() { return current; }, get props() { return props; }, get renders() { return renders; },
      update: async (next: Partial<typeof props>) => {
        props = { ...props, ...next }; await act(async () => tree.update(<Host />));
      } };
  }

  it('does not rerender the photo grid for each handle movement', async () => {
    const h = await setup();
    const before = h.renders;
    await act(async () => {
      for (let offset = 10; offset <= 1_000; offset += 10) h.current.seek(offset);
    });
    expect(h.renders).toBe(before);
    expect(h.props.scrollTo).toHaveBeenLastCalledWith(1_000);
  });

  it('keeps the thumb at the bottom while loading through to the real last page', async () => {
    const h = await setup();
    await act(async () => h.current.seek(9_500));
    expect(h.current.fraction).toBe(1);
    expect(h.props.scrollTo).toHaveBeenLastCalledWith(1_500);
    expect(h.props.onLoadMore).toHaveBeenCalledTimes(1);
    await h.update({ loadingMore: true });
    expect(h.props.onLoadMore).toHaveBeenCalledTimes(1);
    await h.update({ loadedCount: 200, loadedHeight: 4_000, loadingMore: false });
    expect(h.current.fraction).toBe(1);
    expect(h.props.onLoadMore).toHaveBeenCalledTimes(2);
    await h.update({ loadedCount: 500, loadedHeight: 10_000, hasMore: false });
    expect(h.props.scrollTo).toHaveBeenLastCalledWith(9_500);
    expect(h.current.fraction).toBe(1);
  });

  it('waits for native layout after the final metadata page arrives', async () => {
    const h = await setup();
    await act(async () => h.current.seek(9_500));
    // React receives the final items before the native list reports its height.
    await h.update({ loadedCount: 500, hasMore: false, contentHeight: 2_000 });
    expect(h.current.fraction).toBe(1);
    await h.update({ loadedHeight: 10_000, contentHeight: 10_000 });
    expect(h.props.scrollTo).toHaveBeenLastCalledWith(9_500);
    expect(h.current.fraction).toBe(1);
  });

  it('stops fetching once an intermediate target is available', async () => {
    const h = await setup();
    await act(async () => h.current.seek(3_800));
    await h.update({ loadedCount: 250, loadedHeight: 5_000 });
    expect(h.props.scrollTo).toHaveBeenLastCalledWith(3_800);
    expect(h.props.onLoadMore).toHaveBeenCalledTimes(1);
    expect(h.current.fraction).toBeCloseTo(0.4);
  });

  it('does not loop on a failed request, and a new drag can retry', async () => {
    const h = await setup();
    await act(async () => h.current.seek(9_500));
    await h.update({ loadingMore: true });
    await h.update({ loadingMore: false });
    expect(h.props.onLoadMore).toHaveBeenCalledTimes(1);
    await act(async () => { h.current.begin(); h.current.seek(9_400); });
    expect(h.props.onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('cancels pending seeks when normal scrolling resumes', async () => {
    const h = await setup();
    await act(async () => h.current.seek(9_500));
    await act(async () => h.current.cancel());
    h.props.scrollTo.mockClear();
    await h.update({ loadedCount: 200, loadedHeight: 4_000 });
    expect(h.props.scrollTo).not.toHaveBeenCalled();
    expect(h.props.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('keeps the full extent stable as pages append without scaling the header', () => {
    // 300px header/clearance + 50/100 loaded rows of 100px each.
    expect(fullScrollHeight(5_300, 150, 2_400, 3, 100)).toBe(80_300);
    expect(fullScrollHeight(10_300, 300, 2_400, 3, 100)).toBe(80_300);
    expect(fullScrollHeight(10_300, 300, 200, 3, 100)).toBe(10_300);
  });
});
