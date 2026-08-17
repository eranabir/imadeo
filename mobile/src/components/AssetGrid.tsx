import { Image } from 'expo-image';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from 'react-native';
import { ScrollViewMarker } from 'react-native-screens/experimental';
import { duration as formatDuration, thumbnail, type Asset } from '../lib/api';
import { intoDays } from '../lib/day';
import { colors, radius, TAB_BAR_CLEARANCE } from '../theme';
import { AssetViewer } from './AssetViewer';
import { type Rect } from './grow';
import { Icon, type IconName } from './Icon';
import { GridSkeleton } from './Loading';
import { DateLabel, Scrubber, useDayAtTop, useScrolledAway } from './Scrubber';
import { Touchable } from './ui';

interface Props {
  serverUrl: string;
  assets: Asset[];
  token: string | null;
  loading?: boolean;
  onRefresh?: () => void;
  /** Cards, chips and counts that scroll away with the photos. */
  header?: ReactElement | null;
  /** Room for the floating header, which the list passes underneath. */
  topInset?: number;
  columns?: number;
  emptyIcon?: IconName;
  emptyTitle?: string;
  emptyBody?: string;
  /** Anything the empty state should offer to do — suggestions, a button. */
  emptyExtra?: ReactElement | null;
  /**
   * Whether an empty list means an empty screen.
   *
   * A folder holding sub-folders and albums but no loose photos has nothing to
   * put in the grid and is not empty at all — saying "this folder is empty"
   * directly underneath a list of its contents is simply wrong.
   */
  showEmptyState?: boolean;
  /** Photos currently picked out. Passing this turns on selection mode. */
  selected?: string[];
  onToggle?: (id: string) => void;
  /** Takes or drops a whole day. Omitted, the day headings carry no control. */
  onToggleDay?: (ids: string[]) => void;
  onStartSelecting?: (id: string) => void;
  /** Something was changed from the viewer, so this list is stale. */
  onChanged?: () => void;
  /** API pagination follows the native list's recycled cells. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /**
   * Cuts the grid into days, with the date above each.
   *
   * Off by default. A folder or a set of search results is a set of photographs
   * that answer one question, and the day each was taken is beside the point;
   * a library scrolled for minutes is nothing but days.
   */
  groupByDay?: boolean;
}

/**
 * The photo grid, in the one place every screen can share it.
 *
 * Library, an album, a folder, a person and a set of search results are the
 * same list of tiles with different questions behind them, and they had already
 * started to drift apart — the video marker on one was a bare triangle with no
 * length on it, while the device grid next to it showed seconds.
 */
export function AssetGrid({
  serverUrl,
  assets,
  token,
  loading = false,
  onRefresh,
  header,
  topInset = 0,
  columns = 3,
  emptyIcon = 'photo',
  emptyTitle = 'Nothing here yet',
  emptyBody = 'Back up some photos and they will appear.',
  emptyExtra = null,
  showEmptyState = true,
  selected,
  onToggle,
  onToggleDay,
  onStartSelecting,
  onChanged,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  groupByDay = false,
}: Props) {
  const selecting = (selected?.length ?? 0) > 0;
  const [viewing, setViewing] = useState<{ at: number; from: Rect | null } | null>(null);

  /*
   * Where each tile on screen is, so the viewer can grow out of the one tapped.
   *
   * Held by id rather than measured at layout: the grid scrolls, and a position
   * taken when the tile was drawn describes where it used to be. The tap is the
   * only moment the answer is worth having.
   */
  const tiles = useRef(new Map<string, View>()).current;

  // While photos are picked out a tap adds to the selection; otherwise it
  // opens the photo. One gesture, and which it means is never ambiguous
  // because the ticks are on screen whenever it means the first.
  const press = useCallback(
    (id: string, at: number) => {
      if (selecting) return onToggle?.(id);

      const tile = tiles.get(id);
      // `measureInWindow` answers on the next frame; without a tile to ask, the
      // photograph opens without growing rather than not at all.
      if (!tile) return setViewing({ at, from: null });
      tile.measureInWindow((x, y, width, height) =>
        setViewing({ at, from: width > 0 ? { x, y, width, height } : null }),
      );
    },
    [selecting, onToggle, tiles],
  );

  /**
   * One tile. Drawn the same whether the grid is grouped by day or not.
   *
   * `at` is the photo's place in the whole list rather than in its row, because
   * that is what the viewer pages through — a row-relative index would open the
   * wrong photograph on every day but the first.
   */
  const renderTile = (item: Asset, at: number) => {
    const length = formatDuration(item.duration);
    const on = selected?.includes(item.id) ?? false;

    return (
        <Pressable
          key={item.id}
          ref={(node) => {
            if (node) tiles.set(item.id, node);
            else tiles.delete(item.id);
          }}
          onPress={() => press(item.id, at)}
          onLongPress={() => onStartSelecting?.(item.id)}
          delayLongPress={280}
          accessibilityRole={selecting ? 'checkbox' : 'image'}
          accessibilityLabel={item.originalFileName ?? 'Photo'}
          accessibilityState={selecting ? { checked: on } : undefined}
          style={{ flex: 1 / columns, aspectRatio: 1, padding: 1 }}
        >
          {/* Inset while selected, so the tile visibly lifts out of the grid
              rather than only gaining a tick in the corner. */}
          <View
            style={{
              flex: 1,
              padding: on ? 5 : 0,
              backgroundColor: on ? colors.primary : 'transparent',
              borderRadius: on ? radius.sm : 0,
            }}
          >
            <Image
              source={thumbnail(serverUrl, item.id, token)}
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: colors.surface,
                borderRadius: on ? 4 : 0,
                transform: [{ rotate: `${item.rotation ?? 0}deg` }],
              }}
              contentFit="cover"
              recyclingKey={item.id}
              transition={120}
            />
          </View>

          {item.isFavorite && !on && (
            <View style={{ position: 'absolute', left: 6, bottom: 5 }}>
              <Icon name="heart-filled" size={13} color="#fff" />
            </View>
          )}

          {item.type === 'VIDEO' && !on && (
            <View
              style={{
                position: 'absolute',
                right: 5,
                bottom: 5,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Icon name="play" size={11} color="#fff" />
              {length && (
                <Text
                  style={{
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: '600',
                    // A white label on a white-ish photo is otherwise gone.
                    textShadowColor: 'rgba(0,0,0,0.6)',
                    textShadowRadius: 3,
                  }}
                >
                  {length}
                </Text>
              )}
            </View>
          )}

          {selecting && (
            <View
              style={{
                position: 'absolute',
                top: 7,
                right: 7,
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: 2,
                borderColor: on ? colors.primary : 'rgba(255,255,255,0.85)',
                backgroundColor: on ? colors.primary : 'rgba(0,0,0,0.28)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {on && <Icon name="check" size={13} color={colors.onPrimary} strong />}
            </View>
          )}
        </Pressable>
    );
  };

  const days = useMemo(
    () =>
      groupByDay
        ? /*
           * Days with something in them, and rows that are not empty.
           *
           * An empty row reached `keyExtractor`, which reads the first photo in
           * it, and the whole list came down with "cannot read property 'id' of
           * undefined" — taking the dates and the end of the grid with it. The
           * cause belongs upstream; this is the list refusing to be handed one.
           */
          intoDays(assets, (asset) => asset.localDateTime, columns)
            .map((section) => ({ ...section, data: section.data.filter((row) => row.length > 0) }))
            .filter((section) => section.data.length > 0)
        : [],
    [groupByDay, assets, columns],
  );

  /** Where each photo sits in the whole list, for the viewer. */
  const place = useMemo(() => {
    const map = new Map<string, number>();
    assets.forEach((asset, at) => map.set(asset.id, at));
    return map;
  }, [assets]);

  /*
   * What the scrubber and the date label are driven by.
   *
   * The offset lives in an `Animated.Value` so the handle can follow a fling
   * without a render per frame; the day under the bar is state, because it
   * changes a few times a second at most and has to reach a `Text`.
   */
  const scrollY = useRef(new Animated.Value(0)).current;
  const list = useRef<SectionList<Asset[]> | FlatList<Asset[]>>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [away, markAway] = useScrolledAway();

  /*
   * One row of tiles, measured rather than assumed: a tile is a square of a
   * third of the width on one phone and of something else on the next. Only the
   * tail below the grid is set from it, which a point either way cannot spoil.
   */
  const [rowHeight, setRowHeight] = useState(0);

  const [day, markDay, Cell] = useDayAtTop(days, topInset);

  const seek = useCallback((offset: number) => {
    // `scrollTo` on the underlying scroll view rather than `scrollToLocation`:
    // the handle is working in pixels, and section indices cannot answer where
    // 43% of the way down is.
    (list.current as SectionList<Asset[]> | null)
      ?.getScrollResponder()
      ?.scrollTo({ y: offset, animated: false });
  }, []);

  const shared = {
    ref: list as never,
    onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: false,
      listener: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
        markAway(event.nativeEvent.contentOffset.y);
        markDay(event.nativeEvent.contentOffset.y);
      },
    }),
    scrollEventThrottle: 16,
    // The platform's own indicator would sit right beside the handle saying the
    // same thing in grey, and only one of the two can be grabbed.
    showsVerticalScrollIndicator: false,
    onContentSizeChange: (_: number, height: number) => setContentHeight(height),
    onLayout: (event: { nativeEvent: { layout: { height: number } } }) =>
      setViewportHeight(event.nativeEvent.layout.height),
    // Every cell reports where it sits, which is what the date is read from.
    CellRendererComponent: Cell,
    /*
     * Room under the last row for it to be scrolled up to.
     *
     * The label names whatever is at the top of the screen, and without this
     * the final day can never get there — the list runs out first, so the last
     * photographs in a library are the one stretch it cannot name. A screen
     * with the bar and one row of tiles taken out of it is exactly the gap
     * between where the last row ends up and where it has to reach: any less
     * and the scroll stops short of the last day, any more and it runs on past
     * the end into empty space.
     */
    contentContainerStyle: {
      paddingTop: topInset,
      paddingBottom: Math.max(TAB_BAR_CLEARANCE, viewportHeight - topInset - rowHeight),
    },
    ListHeaderComponent: header,
    refreshControl: onRefresh ? (
      <RefreshControl
        refreshing={loading}
        onRefresh={onRefresh}
        tintColor={colors.primary}
        colors={[colors.primary]}
        progressBackgroundColor={colors.surface}
        // Otherwise the spinner appears underneath the glass header.
        progressViewOffset={topInset}
      />
    ) : undefined,
    ListEmptyComponent: !showEmptyState ? null : loading ? (
      // The shape of the grid that is arriving, not a spinner over a void.
      <GridSkeleton columns={columns} />
    ) : (
      <Empty icon={emptyIcon} title={emptyTitle} body={emptyBody}>
        {emptyExtra}
      </Empty>
    ),
    onEndReached: hasMore && !loadingMore ? onLoadMore : undefined,
    onEndReachedThreshold: 1.5,
  };

  if (groupByDay) {
    return (
      <>
        <ScrollViewMarker style={{ flex: 1 }}>
          <SectionList
          sections={days}
          keyExtractor={(row, index) => row[0]?.id ?? `row-${index}`}
          // The heading would otherwise sit under the bar it scrolls beneath.
          stickySectionHeadersEnabled={false}
          /*
           * Nothing above a day until there is a reason for one.
           *
           * A heading over every date turns a wall of photographs into a list
           * of dates, and the label under the bar answers the same question
           * while taking no room in the grid. Selecting is the reason: the
           * headings come back so a whole day can be taken in one press.
           */
          renderSectionHeader={({ section }) =>
            selecting ? (
              <DayHeader
                title={section.title}
                ids={section.data.flat().map((asset) => asset.id)}
                selected={selected}
                onToggleDay={onToggleDay}
              />
            ) : null
          }
          renderItem={({ item: row }) => (
            <View
              style={{ flexDirection: 'row' }}
              onLayout={(event) => {
                const height = event.nativeEvent.layout.height;
                if (Math.abs(height - rowHeight) > 0.5) setRowHeight(height);
              }}
            >
              {row.map((asset) => renderTile(asset, place.get(asset.id) ?? 0))}
              {/* Keeps a short last row aligned with the ones above it rather
                  than spreading its tiles across the width. */}
              {row.length < columns &&
                Array.from({ length: columns - row.length }, (_, i) => (
                  <View key={`gap-${i}`} style={{ flex: 1 / columns }} />
                ))}
            </View>
          )}
            {...shared}
          />
        </ScrollViewMarker>

        {/* Under the bar rather than in the grid, and only where the grid is
            cut into days — a folder or a set of results is not a timeline and
            has no date to report. */}
        {groupByDay && !selecting && (
          <View
            pointerEvents="none"
            // Over the first rows rather than in the gap above them. The bar
            // and the grid meet with 16pt between them and the label is taller
            // than that; floating it is also what Google Photos does with the
            // same label, and it reads as belonging to the photographs.
            style={{ position: 'absolute', top: topInset + 6, left: 0, right: 0 }}
          >
            <DateLabel visible={away}>{day}</DateLabel>
          </View>
        )}

        {/* On every grid, not only the ones cut into days: a folder of two
            thousand photographs is as hard to get through as a timeline, and
            the rail hides itself when there is nowhere to go. */}
        {(
          <Scrubber
            scrollY={scrollY}
            contentHeight={contentHeight}
            viewportHeight={viewportHeight}
            topInset={topInset}
            label={seeking ? day : undefined}
            visible={away || seeking}
            onSeek={seek}
            onDrag={setSeeking}
          />
        )}

        <AssetViewer
          serverUrl={serverUrl}
          token={token}
          assets={assets}
          index={viewing?.at ?? null}
          from={viewing?.from ?? null}
          onClose={() => setViewing(null)}
          onChanged={() => onChanged?.()}
        />
      </>
    );
  }

  return (
    <>
      <ScrollViewMarker style={{ flex: 1 }}>
        <FlatList
          data={assets}
          keyExtractor={(item) => item.id}
          numColumns={columns}
          // Remounts the rows rather than reflowing them: FlatList cannot change
          // numColumns on a live list.
          key={columns}
          contentContainerStyle={{ paddingTop: topInset, paddingBottom: TAB_BAR_CLEARANCE }}
          ListHeaderComponent={header}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={loading}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
                progressBackgroundColor={colors.surface}
                // Otherwise the spinner appears underneath the glass header.
                progressViewOffset={topInset}
              />
            ) : undefined
          }
          renderItem={({ item, index }) => renderTile(item, index)}
          onEndReached={hasMore && !loadingMore ? onLoadMore : undefined}
          onEndReachedThreshold={1.5}
          ListEmptyComponent={
            !showEmptyState ? null : loading ? (
              // The shape of the grid that is arriving, not a spinner over a void.
              <GridSkeleton columns={columns} />
            ) : (
              <Empty icon={emptyIcon} title={emptyTitle} body={emptyBody}>
                {emptyExtra}
              </Empty>
            )
          }
        />
      </ScrollViewMarker>

    <AssetViewer
      serverUrl={serverUrl}
      token={token}
      assets={assets}
      index={viewing?.at ?? null}
      from={viewing?.from ?? null}
      onClose={() => setViewing(null)}
      onChanged={() => onChanged?.()}
    />
    </>
  );
}

/** The same shape wherever a list has nothing to show. */
export function Empty({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: 44, paddingTop: 64 }}>
      <View
        style={{
          width: 74,
          height: 74,
          borderRadius: 37,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={32} color={colors.faint} />
      </View>
      <Text
        style={{
          color: colors.text,
          fontSize: 17.5,
          fontWeight: '700',
          marginTop: 18,
          textAlign: 'center',
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.faint,
          fontSize: 14.5,
          lineHeight: 21,
          marginTop: 7,
          textAlign: 'center',
        }}
      >
        {body}
      </Text>
      {children}
    </View>
  );
}

/**
 * Which photos are picked out, and the two ways that changes.
 *
 * Selection starts on a long press and ends when the last tile is cleared,
 * which is the convention on both platforms — an explicit "select" mode button
 * would be a third thing to find before any of the actions could be reached.
 */
/** The circle's size, and the room it takes once it is there. */
const DAY_MARK = 24;
const DAY_SLOT = DAY_MARK + 10;

/**
 * A day's date, and — once a selection is live — a way to take the whole of it.
 *
 * Hidden until then. A circle beside every date on a library scrolled for
 * minutes is a column of controls down a screen meant to be photographs, and
 * there is nothing to select yet; the way in is the long press that starts a
 * selection everywhere else in the app.
 *
 * It arrives from the left, where a checkbox belongs — ahead of the thing it
 * governs rather than stranded at the far edge — and the date steps aside to
 * let it in rather than the two swapping places between one frame and the next.
 *
 * Filled with the accent once the whole day is in, a dash while part of it is,
 * so the day says what it is rather than what pressing it would do.
 */
export function DayHeader({
  title,
  ids,
  selected,
  onToggleDay,
}: {
  title: string;
  ids: string[];
  selected?: string[];
  onToggleDay?: (ids: string[]) => void;
}) {
  const showing = !!onToggleDay && !!selected && selected.length > 0;
  const all = ids.length > 0 && !!selected && ids.every((id) => selected.includes(id));
  const some = !all && !!selected && ids.some((id) => selected.includes(id));

  const enter = useRef(new Animated.Value(showing ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(enter, {
      toValue: showing ? 1 : 0,
      duration: showing ? 220 : 160,
      easing: Easing.out(Easing.cubic),
      // Width is what moves the date along, and width is not a property the
      // native driver can carry.
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [showing, enter]);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        // Inset from the edge, unlike the tiles below it. The date used to sit
        // flush with them so it read as belonging to the photographs rather
        // than floating above them — but flush against the screen edge is not
        // the same as flush with a grid, and the words ended up against the
        // bezel with nothing to breathe into.
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 18,
        paddingBottom: 6,
      }}
    >
      <Animated.View
        pointerEvents={showing ? 'auto' : 'none'}
        style={{
          width: enter.interpolate({ inputRange: [0, 1], outputRange: [0, DAY_SLOT] }),
          opacity: enter,
          overflow: 'hidden',
          justifyContent: 'center',
        }}
      >
        <Touchable
          onPress={() => onToggleDay?.(ids)}
          radius={radius.pill}
          label={all ? `Deselect ${title}` : `Select all of ${title}`}
        >
          <View
            style={{
              width: DAY_MARK,
              height: DAY_MARK,
              borderRadius: DAY_MARK / 2,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: all ? 0 : 2,
              borderColor: colors.primary,
              backgroundColor: all ? colors.primary : 'transparent',
            }}
          >
            {all ? (
              <Icon name="check" size={14} color={colors.onPrimary} strong />
            ) : some ? (
              <View
                style={{ width: 10, height: 2.5, borderRadius: 2, backgroundColor: colors.primary }}
              />
            ) : null}
          </View>
        </Touchable>
      </Animated.View>

      <Text
        style={{
          flex: 1,
          color: colors.text,
          fontSize: 15,
          fontWeight: '700',
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>
    </View>
  );
}

export function useSelection() {
  const [ids, setIds] = useState<string[]>([]);

  const toggle = useCallback((id: string) => {
    setIds((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }, []);

  const start = useCallback((id: string) => {
    setIds((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  /**
   * A whole day at once.
   *
   * Adds them all unless they are already all in, in which case the press means
   * the opposite — the rule a checkbox at the head of a list follows everywhere.
   */
  const toggleMany = useCallback((many: string[]) => {
    setIds((current) => {
      const chosen = new Set(current);
      const all = many.every((id) => chosen.has(id));
      for (const id of many) {
        if (all) chosen.delete(id);
        else chosen.add(id);
      }
      return [...chosen];
    });
  }, []);

  const clear = useCallback(() => setIds([]), []);

  return { ids, toggle, toggleMany, start, clear, active: ids.length > 0 };
}
