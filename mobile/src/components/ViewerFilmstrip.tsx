import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { DARK, radius } from '../theme';
import { Touchable } from './ui';
import { Icon } from './Icon';
import { VIEWER_FILMSTRIP_HEIGHT } from './viewerGeometry';
import {
  FILMSTRIP_CELL_WIDTH, FILMSTRIP_THUMB_HEIGHT, FILMSTRIP_THUMB_WIDTH,
  filmstripIndex, filmstripInitialIndex, filmstripItemLayout, filmstripOffset, filmstripPadding, FILMSTRIP_EDGE_GUTTER,
} from './filmstripGeometry';

export interface ViewerFilmstripItem {
  id: string;
  source: string | { uri: string; headers?: Record<string, string> };
}

/** Starts at the first photo and scrolls only enough to keep selection visible. */
export function ViewerFilmstrip({ items, current, width, onSelect }: {
  items: ViewerFilmstripItem[];
  current: number;
  width: number;
  onSelect: (index: number) => void;
}) {
  const strip = useRef<FlatList<ViewerFilmstripItem>>(null);
  const previous = useRef<{ index: number; width: number } | null>(null);
  const dragging = useRef(false);
  const initial = useRef({ index: current, offset: { x: filmstripOffset(current, width, items.length), y: 0 } }).current;
  const scrollOffset = useRef(initial.offset.x);
  const dragAnchor = useRef(0);

  const reveal = (animated = false) => {
    if (!items[current] || dragging.current) return;
    const offset = filmstripOffset(current, width, items.length, scrollOffset.current);
    if (Math.abs(offset - scrollOffset.current) < 0.5) return;
    scrollOffset.current = offset;
    strip.current?.scrollToOffset({ offset, animated });
  };
  useEffect(() => {
    const last = previous.current;
    reveal(!!last && last.width === width && Math.abs(last.index - current) === 1);
    previous.current = { index: current, width };
  }, [current, items[current]?.id, items.length, width]);

  const settle = (offset: number) => {
    if (!dragging.current) return;
    dragging.current = false;
    scrollOffset.current = offset;
    const next = filmstripIndex(offset, items.length, dragAnchor.current);
    if (items[next] && next !== current) onSelect(next);
    const visibleOffset = filmstripOffset(next, width, items.length, offset);
    if (Math.abs(visibleOffset - offset) >= 0.5) {
      scrollOffset.current = visibleOffset;
      strip.current?.scrollToOffset({ offset: visibleOffset, animated: false });
    }
  };

  return (
    <FlatList
      ref={strip}
      horizontal
      data={items}
      extraData={current}
      keyExtractor={(item) => item.id}
      style={{ height: VIEWER_FILMSTRIP_HEIGHT, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: filmstripPadding(), alignItems: 'center' }}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      showsHorizontalScrollIndicator={false}
      removeClippedSubviews={false}
      bounces={false}
      initialScrollIndex={items.length ? filmstripInitialIndex(Math.min(initial.index, items.length - 1), width, items.length) : undefined}
      contentOffset={initial.offset}
      initialNumToRender={Math.ceil(width / FILMSTRIP_CELL_WIDTH) + 4}
      windowSize={3}
      maxToRenderPerBatch={8}
      getItemLayout={(_data, index) => filmstripItemLayout(index)}
      snapToInterval={FILMSTRIP_CELL_WIDTH}
      decelerationRate="fast"
      onContentSizeChange={() => reveal()}
      onScroll={event => { scrollOffset.current = event.nativeEvent.contentOffset.x; }}
      scrollEventThrottle={16}
      onScrollBeginDrag={() => {
        dragging.current = true;
        dragAnchor.current = FILMSTRIP_EDGE_GUTTER + current * FILMSTRIP_CELL_WIDTH
          + FILMSTRIP_CELL_WIDTH / 2 - scrollOffset.current;
      }}
      onScrollEndDrag={(event) => {
        // A slow drag can end without a momentum event on iOS.
        if (Math.abs(event.nativeEvent.velocity?.x ?? 0) < 0.01) settle(event.nativeEvent.contentOffset.x);
      }}
      onMomentumScrollEnd={(event) => settle(event.nativeEvent.contentOffset.x)}
      renderItem={({ item, index }) => (
        <Touchable
          onPress={() => { dragging.current = false; onSelect(index); }}
          selected={index === current}
          radius={radius.sm}
          label={`Show item ${index + 1}`}
          style={{ width: FILMSTRIP_CELL_WIDTH, height: VIEWER_FILMSTRIP_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: FILMSTRIP_THUMB_WIDTH, height: FILMSTRIP_THUMB_HEIGHT,
            borderRadius: radius.sm, overflow: 'hidden', backgroundColor: DARK.bg }}>
            <FilmstripImage item={item} />
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
