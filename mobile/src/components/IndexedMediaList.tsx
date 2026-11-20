import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { View, VirtualizedList, useWindowDimensions, type RefreshControlProps } from 'react-native';
import { ScrollViewMarker } from 'react-native-screens/experimental';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IndexedCollection } from '../lib/indexedCollection';
import { colors, TAB_BAR_CLEARANCE } from '../theme';

/** Fixed rows give UIScrollView the real extent, including pages not fetched yet. */
export function IndexedMediaList<T>({ collection, columns, rowHeight: height, topInset = 0, header,
  refreshControl, renderItem, onTopItem, empty, active = true }: {
  collection: IndexedCollection<T>;
  active?: boolean;
  columns: number;
  rowHeight: number | ((width: number) => number);
  topInset?: number;
  header?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  renderItem: (item: T, index: number, visible: boolean) => ReactNode;
  onTopItem?: (item: T | undefined) => void;
  empty?: ReactElement | null;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [layoutWidth, setLayoutWidth] = useState(window.width);
  const rowHeight = typeof height === 'function' ? height(Math.max(1, layoutWidth - insets.left - insets.right)) : height;
  const [headerHeight, setHeaderHeight] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [visible, setVisible] = useState({ start: 0, end: 1 });
  const offset = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ collection, columns, rowHeight, topInset, headerHeight, viewport, onTopItem, active });
  latest.current = { collection, columns, rowHeight, topInset, headerHeight, viewport, onTopItem, active };
  const rows = Math.ceil(collection.total / columns);

  const updateWindow = useCallback(() => {
    const state = latest.current;
    if (!state.active) return;
    const start = Math.max(0, Math.floor((offset.current - state.topInset - state.headerHeight) / state.rowHeight));
    const end = Math.max(start + 1, Math.ceil((offset.current - state.topInset - state.headerHeight + state.viewport) / state.rowHeight));
    setVisible(current => current.start === start && current.end === end ? current : { start, end });
    state.onTopItem?.(state.collection.itemAt(start * state.columns));
    if (timer.current) return;
    // Coalesce a fling into requests for the latest viewport, not every row
    // crossed on its way there. Unneeded in-flight metadata is cancellable.
    timer.current = setTimeout(() => {
      timer.current = null;
      const state = latest.current;
      if (!state.active) return;
      const first = Math.max(0, Math.floor((offset.current - state.topInset - state.headerHeight) / state.rowHeight));
      const last = Math.max(first + 1, Math.ceil((offset.current - state.topInset - state.headerHeight + state.viewport) / state.rowHeight));
      state.collection.loadRange(Math.max(0, first - 1) * state.columns, (last + 1) * state.columns);
    }, 80);
  }, []);
  useEffect(() => { updateWindow(); }, [updateWindow, viewport, headerHeight, rowHeight, columns, collection.key, active]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return <View style={{ flex: 1 }}><ScrollViewMarker style={{ flex: 1 }}>
    <VirtualizedList<number>
      key={`${collection.key}-${columns}-${rowHeight}`}
      style={{ flex: 1 }}
      data={collection}
      extraData={[collection.version, visible]}
      getItem={(_data, index) => index}
      getItemCount={() => rows}
      keyExtractor={row => `row-${row}`}
      getItemLayout={(_data, index) => ({ index, length: rowHeight, offset: topInset + headerHeight + index * rowHeight })}
      initialNumToRender={Math.max(1, Math.ceil((viewport || 900) / rowHeight) + 1)}
      maxToRenderPerBatch={4}
      windowSize={3}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      showsVerticalScrollIndicator
      indicatorStyle="white"
      scrollIndicatorInsets={{ top: topInset, bottom: insets.bottom, right: insets.right }}
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: TAB_BAR_CLEARANCE, paddingLeft: insets.left, paddingRight: insets.right }}
      ListHeaderComponent={<View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>{header}</View>}
      ListEmptyComponent={empty}
      refreshControl={refreshControl}
      onLayout={event => { setViewport(event.nativeEvent.layout.height); setLayoutWidth(event.nativeEvent.layout.width); }}
      onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; updateWindow(); }}
      scrollEventThrottle={32}
      renderItem={({ item: row }) => <View style={{ height: rowHeight, flexDirection: 'row' }}>
        {Array.from({ length: columns }, (_, column) => {
          const index = row * columns + column;
          const item = collection.itemAt(index);
          const loadImage = active && row >= visible.start - 1 && row <= visible.end;
          return item !== undefined
            ? renderItem(item, index, loadImage)
            : <View key={`empty-${index}`} pointerEvents="none" style={{ flex: 1 / columns, height: rowHeight, padding: 1 }}>
              {index < collection.total && <View style={{ flex: 1, backgroundColor: colors.surface }} />}
            </View>;
        })}
      </View>}
    />
  </ScrollViewMarker>
  </View>;
}
