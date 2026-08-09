import { Image } from "expo-image";
import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from "react-native";
import { duration as formatDuration, thumbnail, type Asset } from "../lib/api";
import { intoDays } from "../lib/day";
import { colors, radius, TAB_BAR_CLEARANCE } from "../theme";
import { AssetViewer } from "./AssetViewer";
import { Icon, type IconName } from "./Icon";
import { GridSkeleton } from "./Loading";
import { Touchable } from "./ui";

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
  emptyIcon = "photo",
  emptyTitle = "Nothing here yet",
  emptyBody = "Back up some photos and they will appear.",
  emptyExtra = null,
  showEmptyState = true,
  selected,
  onToggle,
  onToggleDay,
  onStartSelecting,
  onChanged,
  groupByDay = false,
}: Props) {
  const selecting = (selected?.length ?? 0) > 0;
  const [viewing, setViewing] = useState<number | null>(null);

  // While photos are picked out a tap adds to the selection; otherwise it
  // opens the photo. One gesture, and which it means is never ambiguous
  // because the ticks are on screen whenever it means the first.
  const press = useCallback(
    (id: string, at: number) => {
      if (selecting) onToggle?.(id);
      else setViewing(at);
    },
    [selecting, onToggle],
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
        onPress={() => press(item.id, at)}
        onLongPress={() => onStartSelecting?.(item.id)}
        delayLongPress={280}
        accessibilityRole={selecting ? "checkbox" : "image"}
        accessibilityLabel={item.originalFileName ?? "Photo"}
        accessibilityState={selecting ? { checked: on } : undefined}
        style={{ flex: 1 / columns, aspectRatio: 1, padding: 1 }}
      >
        {/* Inset while selected, so the tile visibly lifts out of the grid
              rather than only gaining a tick in the corner. */}
        <View
          style={{
            flex: 1,
            padding: on ? 5 : 0,
            backgroundColor: on ? colors.primary : "transparent",
            borderRadius: on ? radius.sm : 0,
          }}
        >
          <Image
            source={thumbnail(serverUrl, item.id, token)}
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: colors.surface,
              borderRadius: on ? 4 : 0,
            }}
            contentFit="cover"
            recyclingKey={item.id}
            transition={120}
          />
        </View>

        {item.isFavorite && !on && (
          <View style={{ position: "absolute", left: 6, bottom: 5 }}>
            <Icon name="heart-filled" size={13} color="#fff" />
          </View>
        )}

        {item.type === "VIDEO" && !on && (
          <View
            style={{
              position: "absolute",
              right: 5,
              bottom: 5,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="play" size={11} color="#fff" />
            {length && (
              <Text
                style={{
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: "600",
                  // A white label on a white-ish photo is otherwise gone.
                  textShadowColor: "rgba(0,0,0,0.6)",
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
              position: "absolute",
              top: 7,
              right: 7,
              width: 22,
              height: 22,
              borderRadius: 11,
              borderWidth: 2,
              borderColor: on ? colors.primary : "rgba(255,255,255,0.85)",
              backgroundColor: on ? colors.primary : "rgba(0,0,0,0.28)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {on && (
              <Icon name="check" size={13} color={colors.onPrimary} strong />
            )}
          </View>
        )}
      </Pressable>
    );
  };

  const days = useMemo(
    () =>
      groupByDay
        ? intoDays(assets, (asset) => asset.localDateTime, columns)
        : [],
    [groupByDay, assets, columns],
  );

  /** Where each photo sits in the whole list, for the viewer. */
  const place = useMemo(() => {
    const map = new Map<string, number>();
    assets.forEach((asset, at) => map.set(asset.id, at));
    return map;
  }, [assets]);

  const shared = {
    contentContainerStyle: {
      paddingTop: topInset,
      paddingBottom: TAB_BAR_CLEARANCE,
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
  };

  if (groupByDay) {
    return (
      <>
        <SectionList
          sections={days}
          keyExtractor={(row) => row[0].id}
          // The heading would otherwise sit under the bar it scrolls beneath.
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <DayHeader
              title={section.title}
              ids={section.data.flat().map((asset) => asset.id)}
              selected={selected}
              onToggleDay={onToggleDay}
            />
          )}
          renderItem={({ item: row }) => (
            <View style={{ flexDirection: "row" }}>
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

        <AssetViewer
          serverUrl={serverUrl}
          token={token}
          assets={assets}
          index={viewing}
          onClose={() => setViewing(null)}
          onChanged={() => onChanged?.()}
        />
      </>
    );
  }

  return (
    <>
      <FlatList
        data={assets}
        keyExtractor={(item) => item.id}
        numColumns={columns}
        // Remounts the rows rather than reflowing them: FlatList cannot change
        // numColumns on a live list.
        key={columns}
        contentContainerStyle={{
          paddingTop: topInset,
          paddingBottom: TAB_BAR_CLEARANCE,
        }}
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

      <AssetViewer
        serverUrl={serverUrl}
        token={token}
        assets={assets}
        index={viewing}
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
    <View
      style={{ alignItems: "center", paddingHorizontal: 44, paddingTop: 64 }}
    >
      <View
        style={{
          width: 74,
          height: 74,
          borderRadius: 37,
          backgroundColor: colors.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={32} color={colors.faint} />
      </View>
      <Text
        style={{
          color: colors.text,
          fontSize: 17.5,
          fontWeight: "700",
          marginTop: 18,
          textAlign: "center",
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
          textAlign: "center",
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
/**
 * A day's date, and a way to take the whole of it.
 *
 * The control is a circle rather than the words "Select all" on a plate. Every
 * photo library draws this as a circle beside the date — it is the same mark
 * that appears on each tile when a selection is live, at the size of a heading
 * — and a row of dates each carrying a small grey button read as a toolbar
 * stuck to every day rather than as the library's own spine.
 *
 * It fills with the accent once the whole day is in, so the day says what it is
 * rather than what pressing it would do.
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
  const all =
    ids.length > 0 &&
    selected !== undefined &&
    ids.every((id) => selected.includes(id));
  const some =
    !all && selected !== undefined && ids.some((id) => selected.includes(id));

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        // Flush with the tiles, which sit at the screen edge with only their
        // gutter.
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 18,
        paddingBottom: 5,
      }}
    >
      <Text
        style={{
          flex: 1,
          color: colors.text,
          fontSize: 15,
          fontWeight: "700",
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>

      {onToggleDay && (
        <Touchable
          onPress={() => onToggleDay(ids)}
          radius={radius.pill}
          label={all ? `Deselect ${title}` : `Select all of ${title}`}
        >
          <View style={{ padding: 6 }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: all ? 0 : 1.5,
                borderColor: some ? colors.primary : colors.border,
                backgroundColor: all ? colors.primary : "transparent",
              }}
            >
              {all ? (
                <Icon name="check" size={13} color={colors.onPrimary} strong />
              ) : some ? (
                <View
                  style={{
                    width: 9,
                    height: 2.5,
                    borderRadius: 2,
                    backgroundColor: colors.primary,
                  }}
                />
              ) : null}
            </View>
          </View>
        </Touchable>
      )}
    </View>
  );
}

export function useSelection() {
  const [ids, setIds] = useState<string[]>([]);

  const toggle = useCallback((id: string) => {
    setIds((current) =>
      current.includes(id)
        ? current.filter((other) => other !== id)
        : [...current, id],
    );
  }, []);

  const start = useCallback((id: string) => {
    setIds((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  /**
   * A whole day at once.
   *
   * Adds them all unless they are already all in, in which case the press means
   * the opposite — the same rule a checkbox at the head of a list follows
   * everywhere else.
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
