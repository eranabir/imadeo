import type { IndexedCollection } from '../lib/indexedCollection';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { FlatList, VirtualizedList, View } from 'react-native';
import { DARK, radius } from '../theme';
import { Touchable } from './ui';
import { Icon } from './Icon';
import { VIEWER_FILMSTRIP_HEIGHT } from './viewerGeometry';
import {
  FILMSTRIP_CELL_WIDTH, FILMSTRIP_THUMB_HEIGHT, FILMSTRIP_THUMB_WIDTH,
  filmstripInitialIndex, filmstripItemLayout, filmstripOffset, filmstripSnapOffset, filmstripViewportWidth, FILMSTRIP_EDGE_GUTTER,
} from './filmstripGeometry';

export interface ViewerFilmstripItem {
  id: string;
  source: string | { uri: string; headers?: Record<string, string> };
}

/** Starts at the first photo and scrolls only enough to keep selection visible. */
export function ViewerFilmstrip({ items, collection, current, width: availableWidth, onSelect }: {
  items: ViewerFilmstripItem[];
  collection?: IndexedCollection<ViewerFilmstripItem>;
  current: number;
  width: number;
  onSelect: (index: number) => void;
}) {
  const count = collection?.total ?? items.length;
  const itemAt = (at: number) => collection ? collection.itemAt(at) : items[at];
  const List = (collection ? VirtualizedList : FlatList) as typeof FlatList<ViewerFilmstripItem | undefined>;
  const width = filmstripViewportWidth(availableWidth, count);
  const strip = useRef<FlatList<ViewerFilmstripItem>>(null);
  const previous = useRef<{ index: number; width: number } | null>(null);
  const dragging = useRef(false);
  const initial = useRef({ index: current, offset: { x: filmstripOffset(current, width, count), y: 0 } }).current;
  const scrollOffset = useRef(initial.offset.x);
  const suppressPress = useRef(false);

  const reveal = (animated = false) => {
    if (!itemAt(current) || dragging.current) return;
    const restingOffset = filmstripSnapOffset(scrollOffset.current, width, count);
    const offset = filmstripOffset(current, width, count, restingOffset);
    if (Math.abs(offset - scrollOffset.current) < 0.5) return;
    scrollOffset.current = offset;
    strip.current?.scrollToOffset({ offset, animated });
  };
  useEffect(() => {
    const last = previous.current;
    reveal(!!last && last.width === width && Math.abs(last.index - current) === 1);
    previous.current = { index: current, width };
  }, [current, itemAt(current)?.id, count, width]);

  const settle = (offset: number) => {
    if (!dragging.current) return;
    dragging.current = false;
    const snapped = filmstripSnapOffset(offset, width, count);
    scrollOffset.current = snapped;
    if (Math.abs(snapped - offset) >= 0.5) {
      strip.current?.scrollToOffset({ offset: snapped, animated: true });
    }
  };

  return (
    <List
      ref={strip as never}
      horizontal
      data={collection ? { length: count } : items}
      {...(collection ? { getItem: (_data: unknown, index: number) => itemAt(index), getItemCount: () => count } : {})}
      extraData={[current, collection?.version]}
      keyExtractor={(item, index) => item?.id ?? `pending-${index}`}
      style={{ width: Math.max(0, width - 2 * FILMSTRIP_EDGE_GUTTER), marginHorizontal: FILMSTRIP_EDGE_GUTTER,
        height: VIEWER_FILMSTRIP_HEIGHT, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: 0, alignItems: 'center' }}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      showsHorizontalScrollIndicator={false}
      removeClippedSubviews={false}
      bounces={false}
      initialScrollIndex={count ? filmstripInitialIndex(Math.min(initial.index, count - 1), width, count) : undefined}
      contentOffset={initial.offset}
      initialNumToRender={Math.ceil(width / FILMSTRIP_CELL_WIDTH) + 4}
      windowSize={3}
      maxToRenderPerBatch={8}
      getItemLayout={(_data, index) => {
        // Gutters sit outside the scroll view, so another image cannot peek
        // through them when the viewport ends between complete cells.
        const layout = filmstripItemLayout(index);
        return { ...layout, offset: layout.offset - FILMSTRIP_EDGE_GUTTER };
      }}
      snapToInterval={FILMSTRIP_CELL_WIDTH}
      snapToAlignment="start"
      decelerationRate="fast"
      onContentSizeChange={() => reveal()}
      onScroll={event => {
        scrollOffset.current = event.nativeEvent.contentOffset.x;
        const at = Math.floor(scrollOffset.current / FILMSTRIP_CELL_WIDTH);
        collection?.loadRange(Math.max(0, at - 2), at + Math.ceil(width / FILMSTRIP_CELL_WIDTH) + 2);
      }}
      scrollEventThrottle={16}
      onScrollBeginDrag={() => {
        dragging.current = true;
        suppressPress.current = true;
      }}
      onScrollEndDrag={(event) => {
        // A slow drag can end without a momentum event on iOS.
        if (Math.abs(event.nativeEvent.velocity?.x ?? 0) < 0.01) settle(event.nativeEvent.contentOffset.x);
      }}
      onMomentumScrollEnd={(event) => settle(event.nativeEvent.contentOffset.x)}
      renderItem={({ item, index }) => (
        <Touchable
          onPress={() => { if (!suppressPress.current && item) onSelect(index); }}
          onPressIn={() => { suppressPress.current = dragging.current; }}
          selected={index === current}
          radius={radius.sm}
          label={`Show item ${index + 1}`}
          style={{ width: FILMSTRIP_CELL_WIDTH, height: VIEWER_FILMSTRIP_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: FILMSTRIP_THUMB_WIDTH, height: FILMSTRIP_THUMB_HEIGHT,
            borderRadius: radius.sm, overflow: 'hidden', backgroundColor: DARK.bg }}>
            {item ? <FilmstripImage item={item} /> : <Icon name="photo" size={18} color={DARK.muted} />}
            {index === current && <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0,
              left: 0, right: 0, borderRadius: radius.sm, borderWidth: 2, borderColor: DARK.primary }} />}
          </View>
        </Touchable>
      )}
    />
  );
}

function FilmstripImage({ item }: { item: ViewerFilmstripItem }) {
  const [displayed, setDisplayed] = useState(false);
  return <>
    {!displayed && <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
      alignItems: 'center', justifyContent: 'center' }}><Icon name="photo" size={18} color={DARK.muted} /></View>}
    <Image source={item.source} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk"
      transition={0} recyclingKey={`viewer-strip-${item.id}`} onDisplay={() => setDisplayed(true)} onError={() => setDisplayed(false)} />
  </>;
}
