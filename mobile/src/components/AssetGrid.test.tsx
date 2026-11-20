import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ event: vi.fn(), thumbnails: vi.fn() }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  View: 'View', Text: 'Text', Pressable: 'Pressable', RefreshControl: 'RefreshControl',
  FlatList: 'FlatList', SectionList: 'SectionList',
  useWindowDimensions: () => ({ width: 402, height: 874 }),
  Animated: { Value: class {}, createAnimatedComponent: (component: any) => component,
    event: mocks.event.mockImplementation((_mapping, config) => Object.assign(config.listener, { nativeDriver: config.useNativeDriver })) },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) }));
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));
vi.mock('react-native-screens/experimental', () => ({ ScrollViewMarker: 'ScrollViewMarker' }));
vi.mock('./AssetViewer', () => ({ AssetViewer: 'AssetViewer' }));
vi.mock('./AssetThumbnail', () => ({ AssetThumbnail: (props: any) => { mocks.thumbnails(props); return React.createElement('Thumbnail', props); } }));
vi.mock('./Icon', () => ({ Icon: 'Icon' }));
vi.mock('./Loading', () => ({ GridSkeleton: 'GridSkeleton', ListSkeleton: 'ListSkeleton' }));
vi.mock('./ui', () => ({ Touchable: 'Touchable' }));
vi.mock('./Scrubber', async () => {
  const { useScrolledAway } = await vi.importActual<typeof import('./Scrubber')>('./Scrubber');
  return { Scrubber: 'Scrubber', DateLabel: 'DateLabel', useScrolledAway,
    useDayAtTop: () => [undefined, vi.fn(), 'Cell'] };
});
vi.mock('../lib/api', () => ({ duration: () => '' }));
import { AssetGrid } from './AssetGrid';
import type { Asset } from '../lib/api';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });

describe('Large folder scrolling', () => {
  it('uses a native scroll driver and bounded rendering batches for thousands of images', async () => {
    const assets = Array.from({ length: 5_000 }, (_, i) => ({ id: `photo-${i}` }) as Asset);
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<AssetGrid assets={assets} serverUrl="https://photos.test" token="token" />); });
    mounted.push(tree);
    const list = () => tree.root.findByType('FlatList' as any);
    expect(list().props.data).toBe(assets);
    expect(list().props.windowSize).toBe(5);
    expect(list().props.maxToRenderPerBatch).toBe(6);
    expect(list().props.onScroll.nativeDriver).toBe(true);
    expect(list().props.showsVerticalScrollIndicator).toBe(true);
    expect(list().props.onContentSizeChange).toBeUndefined();
    expect(tree.root.findAllByType('PhotoScrollHandle' as any)).toHaveLength(0);
    await act(async () => list().props.onScroll({ nativeEvent: { contentOffset: { y: 100 } } }));
    const renderItem = list().props.renderItem;
    // Once the indicator is visible, an entire fling must not rerender the
    // grid for every scroll event (which would rebuild every mounted tile).
    for (let y = 200; y < 10_000; y += 100) {
      await act(async () => list().props.onScroll({ nativeEvent: { contentOffset: { y } } }));
    }
    expect(list().props.renderItem).toBe(renderItem);
  });
});
