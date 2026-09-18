import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filmstripItemLayout, filmstripOffset, filmstripPadding, FILMSTRIP_CELL_WIDTH } from './filmstripGeometry';

vi.mock('react-native', () => ({ FlatList: 'FlatList', View: 'View', Platform: { OS: 'ios' } }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('./Icon', () => ({ Icon: 'Icon' }));
vi.mock('./ui', () => ({ Touchable: (props: any) => React.createElement('Touchable', props, props.children) }));
import { ViewerFilmstrip } from './ViewerFilmstrip';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
const items = Array.from({ length: 120 }, (_, n) => ({ id: `${n}`, source: `ph://photo-${n}` }));
async function render(current = 50, width = 440) {
  const onSelect = vi.fn(), scrollToOffset = vi.fn();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<ViewerFilmstrip items={items} current={current} width={width} onSelect={onSelect} />,
    { createNodeMock: element => element.type === 'FlatList' ? { scrollToOffset } : null }); });
  mounted.push(tree);
  return { tree, onSelect, scrollToOffset, props: () => tree.root.findByType('FlatList' as any).props };
}
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });

describe('Viewer filmstrip', () => {
  for (const width of [320, 402, 440, 874, 1024, 1366]) {
    it(`centres first, middle and last thumbnails at width ${width}, including content padding`, () => {
      for (const index of [0, 50, 119]) {
        const frame = filmstripItemLayout(width, index);
        expect(frame.offset + frame.length / 2 - filmstripOffset(index)).toBe(width / 2);
        const contentWidth = 120 * FILMSTRIP_CELL_WIDTH + 2 * filmstripPadding(width);
        expect(filmstripOffset(index)).toBeLessThanOrEqual(contentWidth - width);
      }
    });
  }
  it('opens directly on a distant selection, not at the start or the leading edge', async () => {
    const { props, scrollToOffset } = await render(119);
    // Render both sides of the centred selection on the FIRST frame. Starting
    // at 119 leaves all the visible preceding cells blank until another scroll.
    expect(props().initialScrollIndex).toBe(113);
    expect(props().contentOffset).toEqual({ x: 119 * 44, y: 0 });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 119 * 44, animated: false });
    expect(props().removeClippedSubviews).toBe(false);
    expect(props().windowSize).toBe(3);
    expect(props().maxToRenderPerBatch).toBe(8);
  });
  it('selects the snapped photo when a drag ends, and only once', async () => {
    const { props, onSelect } = await render();
    await act(async () => props().onScrollBeginDrag());
    await act(async () => props().onScrollEndDrag({ nativeEvent: { velocity: { x: 0 }, contentOffset: { x: 52 * 44 + 5 } } }));
    await act(async () => props().onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 52 * 44 } } }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(52);
  });
  it('lets momentum finish without fighting the finger or selecting intermediate photos', async () => {
    const { props, onSelect, scrollToOffset } = await render();
    scrollToOffset.mockClear();
    await act(async () => props().onScrollBeginDrag());
    await act(async () => props().onContentSizeChange());
    await act(async () => props().onScrollEndDrag({ nativeEvent: { velocity: { x: 1 }, contentOffset: { x: 52 * 44 } } }));
    expect(onSelect).not.toHaveBeenCalled(); expect(scrollToOffset).not.toHaveBeenCalled();
    await act(async () => props().onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 65 * 44 } } }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(65);
  });
  it('recentres after paging, rotation, or deleting the current item', async () => {
    const { tree, onSelect, scrollToOffset } = await render();
    await act(async () => tree.update(<ViewerFilmstrip items={items} current={51} width={440} onSelect={onSelect} />));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 51 * 44, animated: true });
    await act(async () => tree.update(<ViewerFilmstrip items={items} current={51} width={874} onSelect={onSelect} />));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 51 * 44, animated: false });
    await act(async () => tree.update(<ViewerFilmstrip items={items.filter((_, i) => i !== 51)} current={51} width={874} onSelect={onSelect} />));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 51 * 44, animated: false });
  });
  it('keeps selected and unselected thumbnail frames the same size', async () => {
    const { props, onSelect } = await render();
    const selected = props().renderItem({ item: items[50], index: 50 });
    const neighbour = props().renderItem({ item: items[51], index: 51 });
    expect(selected.props.style).toEqual(neighbour.props.style);
    expect(selected.props.children.props.style).toEqual(neighbour.props.children.props.style);
    expect(selected.props.selected).toBe(true);
    selected.props.onPress(); expect(onSelect).toHaveBeenCalledWith(50);
  });
});
