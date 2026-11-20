import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, View: 'View', VirtualizedList: 'VirtualizedList', useWindowDimensions: () => ({ width: 390, height: 844 }) }));
vi.mock('react-native-screens/experimental', () => ({ ScrollViewMarker: 'ScrollViewMarker' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }) }));
import { IndexedMediaList } from './IndexedMediaList';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => { await act(async () => tree?.unmount()); vi.useRealTimers(); });

describe('Indexed native scroll geometry', () => {
  it('keeps all 22,680 positions while requesting only the latest distant viewport', async () => {
    vi.useFakeTimers();
    const collection = { key: 'photos', total: 22680, version: 1,
      itemAt: (index: number) => ({ id: String(index) }), loadRange: vi.fn() };
    const tile = vi.fn((item, index, visible) => <React.Fragment key={index}>{visible ? item.id : null}</React.Fragment>);
    await act(async () => { tree = create(<IndexedMediaList collection={collection} columns={3} rowHeight={130} renderItem={tile} />); });
    const list = () => tree.root.findByType('VirtualizedList' as any);
    await act(async () => { list().props.onLayout({ nativeEvent: { layout: { width: 390, height: 780 } } }); vi.advanceTimersByTime(80); });
    collection.loadRange.mockClear();
    expect(list().props.getItemCount()).toBe(7560);
    expect(list().props.getItemLayout(null, 7559)).toEqual({ index: 7559, length: 130, offset: 982670 });
    await act(async () => {
      for (const y of [50000, 400000, 981890]) list().props.onScroll({ nativeEvent: { contentOffset: { y } } });
    });
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(collection.loadRange.mock.calls).toEqual([[22656, 22680]]);
    expect(list().props.showsVerticalScrollIndicator).toBe(true);
    expect(list().props.scrollToOffset).toBeUndefined();
    list().props.renderItem({ item: 0 });
    expect(tile.mock.calls.slice(-3).every(call => call[2] === false)).toBe(true);
    list().props.renderItem({ item: 7559 });
    expect(tile.mock.calls.slice(-3).every(call => call[2] === true)).toBe(true);
  });
  it('pauses hidden grid requests and restores its visible range when the viewer closes', async () => {
    vi.useFakeTimers();
    const collection = { key: 'photos', total: 22680, version: 1, itemAt: () => undefined, loadRange: vi.fn() };
    const render = (active: boolean) => <IndexedMediaList collection={collection} columns={3} rowHeight={130} active={active} renderItem={() => null} />;
    await act(async () => { tree = create(render(true)); });
    await act(async () => { vi.advanceTimersByTime(80); });
    collection.loadRange.mockClear();
    await act(async () => { tree.update(render(false)); });
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(collection.loadRange).not.toHaveBeenCalled();
    await act(async () => { tree.update(render(true)); });
    await act(async () => { vi.advanceTimersByTime(80); });
    expect(collection.loadRange).toHaveBeenCalledTimes(1);
  });

});
