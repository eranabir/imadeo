import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filmstripItemLayout, filmstripOffset, filmstripMaxOffset,
  FILMSTRIP_CELL_WIDTH, FILMSTRIP_EDGE_GUTTER,
} from './filmstripGeometry';

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
  for (const width of [288, 320, 402, 440, 560, 874, 1024, 1366]) {
    it(`starts at the edge and clamps the last selection at width ${width}`, () => {
      expect(filmstripItemLayout(0).offset).toBe(FILMSTRIP_EDGE_GUTTER);
      expect(filmstripOffset(0, width, items.length)).toBe(0);
      expect(filmstripOffset(1, width, items.length)).toBe(0);
      for (const index of [0, 50, 119]) {
        const frame = filmstripItemLayout(index);
        const offset = filmstripOffset(index, width, items.length);
        expect(frame.offset - offset).toBeGreaterThanOrEqual(FILMSTRIP_EDGE_GUTTER);
        expect(frame.offset + frame.length - offset).toBeLessThanOrEqual(width - FILMSTRIP_EDGE_GUTTER);
        expect(offset).toBeLessThanOrEqual(filmstripMaxOffset(width, items.length));
      }
      expect(filmstripOffset(119, width, items.length)).toBe(filmstripMaxOffset(width, items.length));
    });
  }
  it('keeps the first thumbnail at the leading gutter when opening the second photo', async () => {
    const { props, scrollToOffset } = await render(1);
    expect(props().contentContainerStyle.paddingHorizontal).toBe(8);
    expect(props().contentOffset).toEqual({ x: 0, y: 0 });
    expect(scrollToOffset).not.toHaveBeenCalled();
  });
  it('renders all visible preceding thumbnails when opening the last selection', async () => {
    const { props } = await render(119);
    const max = 120 * FILMSTRIP_CELL_WIDTH + 16 - 440;
    expect(props().initialScrollIndex).toBe(109);
    expect(props().contentOffset).toEqual({ x: max, y: 0 });
    expect(props().removeClippedSubviews).toBe(false);
    expect(props().windowSize).toBe(3);
    expect(props().maxToRenderPerBatch).toBe(8);
  });
  it('selects relative to the current thumbnail when a drag ends, and only once', async () => {
    const { props, onSelect } = await render();
    const offset = props().contentOffset.x + 2 * 44;
    await act(async () => props().onScrollBeginDrag());
    await act(async () => props().onScrollEndDrag({ nativeEvent: { velocity: { x: 0 }, contentOffset: { x: offset + 5 } } }));
    await act(async () => props().onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: offset } } }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(52);
  });
  it('does not change the second selection after a drag settles at the beginning', async () => {
    const { props, onSelect } = await render(1);
    await act(async () => props().onScrollBeginDrag());
    await act(async () => props().onScrollEndDrag({ nativeEvent: { velocity: { x: 0 }, contentOffset: { x: 0 } } }));
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('lets momentum finish without fighting the finger or selecting intermediate photos', async () => {
    const { props, onSelect, scrollToOffset } = await render();
    const initial = props().contentOffset.x;
    await act(async () => props().onScrollBeginDrag());
    await act(async () => props().onContentSizeChange());
    await act(async () => props().onScrollEndDrag({ nativeEvent: { velocity: { x: 1 }, contentOffset: { x: initial + 2 * 44 } } }));
    expect(onSelect).not.toHaveBeenCalled(); expect(scrollToOffset).not.toHaveBeenCalled();
    await act(async () => props().onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: initial + 15 * 44 } } }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(65);
  });
  it('scrolls only when the next selection leaves the visible area', async () => {
    const { tree, onSelect, scrollToOffset } = await render(0);
    await act(async () => tree.update(<ViewerFilmstrip items={items} current={1} width={440} onSelect={onSelect} />));
    await act(async () => tree.update(<ViewerFilmstrip items={items} current={8} width={440} onSelect={onSelect} />));
    expect(scrollToOffset).not.toHaveBeenCalled();
    await act(async () => tree.update(<ViewerFilmstrip items={items} current={9} width={440} onSelect={onSelect} />));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 16, animated: true });
  });
  it('keeps a visible selection steady on expansion and reclamps after deletion at the end', async () => {
    const { tree, onSelect, scrollToOffset } = await render();
    await act(async () => tree.update(<ViewerFilmstrip items={items} current={50} width={874} onSelect={onSelect} />));
    expect(scrollToOffset).not.toHaveBeenCalled();
    await act(async () => tree.update(<ViewerFilmstrip items={items} current={119} width={874} onSelect={onSelect} />));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: filmstripMaxOffset(874, 120), animated: false });
    await act(async () => tree.update(<ViewerFilmstrip items={items.slice(0, -1)} current={118} width={874} onSelect={onSelect} />));
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: filmstripMaxOffset(874, 119), animated: true });
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
