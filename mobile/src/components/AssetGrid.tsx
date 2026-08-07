import { Image } from 'expo-image';
import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { duration as formatDuration, thumbnail, type Asset } from '../lib/api';
import { colors, radius, TAB_BAR_CLEARANCE } from '../theme';
import { AssetViewer } from './AssetViewer';
import { Icon, type IconName } from './Icon';
import { GridSkeleton } from './Loading';

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
  onStartSelecting?: (id: string) => void;
  /** Something was changed from the viewer, so this list is stale. */
  onChanged?: () => void;
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
  onStartSelecting,
  onChanged,
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

  return (
    <>
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
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
            // Otherwise the spinner appears underneath the glass header.
            progressViewOffset={topInset}
          />
        ) : undefined
      }
      renderItem={({ item, index }) => {
        const length = formatDuration(item.duration);
        const on = selected?.includes(item.id) ?? false;

        return (
          <Pressable
            onPress={() => press(item.id, index)}
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
                backgroundColor: on ? colors.accent : 'transparent',
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
                  borderColor: on ? colors.accent : 'rgba(255,255,255,0.85)',
                  backgroundColor: on ? colors.accent : 'rgba(0,0,0,0.28)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {on && <Icon name="check" size={13} color={colors.onAccent} strong />}
              </View>
            )}
          </Pressable>
        );
      }}
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

  const clear = useCallback(() => setIds([]), []);

  return { ids, toggle, start, clear, active: ids.length > 0 };
}
