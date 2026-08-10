import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { autoplayVideos } from '../lib/preferences';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions } from '../lib/actions';
import { duration as formatDuration, type Asset } from '../lib/api';
import { colors, radius } from '../theme';
import { useGrowFrom, type Rect } from './grow';
import { Icon, type IconName } from './Icon';
import { ConfirmSheet } from './sheets';
import { Touchable } from './ui';

interface Props {
  serverUrl: string;
  token: string | null;
  assets: Asset[];
  /** Which one was tapped. Null closes the viewer. */
  index: number | null;
  /** The tile it was tapped on, when it could be measured in time. */
  from?: Rect | null;
  onClose: () => void;
  /** Something was changed from in here, so the grid behind is stale. */
  onChanged: () => void;
}

/**
 * One photo or video, full screen, with the rest a swipe away.
 *
 * A paged horizontal list rather than a screen per asset: the whole point of
 * opening a photo is to keep going through the ones either side of it, and a
 * push-and-pop for every swipe would reload each one from scratch.
 *
 * A `Modal` rather than an entry on the navigation stack, because this has to
 * cover a pushed folder screen as readily as a tab — and it is genuinely modal,
 * with its own back behaviour and nothing underneath worth showing.
 */
export function AssetViewer({ serverUrl, token, assets, index, from, onClose, onChanged }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Asset>>(null);

  const [current, setCurrent] = useState(index ?? 0);
  const [chrome, setChrome] = useState(true);
  const [trashing, setTrashing] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Overrides the server's answer for anything favourited in this session. */
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  /** Which page it opened on, kept for the way back out. */
  const opened = useRef(index ?? 0);

  // Opening on the tapped photo rather than the first one. The list is only
  // mounted while the viewer is open, so this runs once per opening.
  useEffect(() => {
    if (index === null) return;
    opened.current = index;
    setCurrent(index);
    setChrome(true);
    setFavorites({});
  }, [index]);

  /*
   * Back into the tile only while that tile is still the photograph on screen.
   * After a swipe the one it was opened from is somewhere else entirely, and
   * shrinking into the wrong square is worse than not shrinking at all.
   */
  const { mounted, enter, grown } = useGrowFrom(
    current === opened.current ? from ?? null : null,
    index !== null,
  );

  if (!mounted) return null;

  const asset = assets[current];
  if (!asset) return null;

  const favorite = favorites[asset.id] ?? asset.isFavorite ?? false;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        {/* The dark comes up under the photograph rather than with it, so the
            grid is still there to be left behind. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.viewer, opacity: enter }]}
        />

        <Animated.View style={[StyleSheet.absoluteFill, grown]}>
        <FlatList
          ref={list}
          data={assets}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={opened.current}
          // Every page is exactly the screen's width, so the list never has to
          // measure anything to jump straight to the one that was tapped.
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(event) =>
            setCurrent(Math.round(event.nativeEvent.contentOffset.x / width))
          }
          // Only the visible page and its immediate neighbours stay alive: each
          // video page owns a native player, and a hundred of them would be a
          // hundred decoders.
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          renderItem={({ item, index: i }) => (
            <Pressable
              onPress={() => setChrome((on) => !on)}
              style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
            >
              {item.type === 'VIDEO' ? (
                <VideoPage
                  uri={`${serverUrl}/api/assets/${item.id}/video`}
                  token={token}
                  active={i === current}
                  width={width}
                  height={height}
                />
              ) : (
                <Image
                  source={{
                    uri: `${serverUrl}/api/assets/${item.id}/thumbnail?size=preview`,
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                  }}
                  style={{ width, height }}
                  contentFit="contain"
                  transition={140}
                  recyclingKey={item.id}
                />
              )}
            </Pressable>
          )}
        />
        </Animated.View>

        {chrome && (
          <>
            {/* Fades with the photograph rather than arriving over the grid
                while it is still on its way up. */}
            <Animated.View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                paddingTop: insets.top + 8,
                paddingBottom: 12,
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: colors.overlay,
                opacity: enter,
              }}
            >
              <Touchable onPress={onClose} radius={radius.pill} label="Close" style={{ width: 38, height: 38 }}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="close" size={22} color="#fff" />
                </View>
              </Touchable>

              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
                  {asset.originalFileName ?? 'Photo'}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 1 }}>
                  {[
                    asset.localDateTime
                      ? new Date(asset.localDateTime).toLocaleDateString()
                      : null,
                    formatDuration(asset.duration),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>

              {/*
                Favourite and trash live up here beside the close button.

                They used to sit in a bar along the bottom, which is exactly
                where a video puts its own scrubber and play button — so on
                every video the two overlapped and the app's controls covered
                the ones people actually needed. The bottom edge belongs to
                whatever is being played; this bar owns the asset itself.
              */}
              <ViewerAction
                // Hollow means "not yet", solid means "already". The label
                // carries the action; the glyph carries the state.
                icon={favorite ? 'heart-filled' : 'heart'}
                label={favorite ? 'Remove from favourites' : 'Favourite'}
                tint={favorite ? colors.danger : '#fff'}
                disabled={busy}
                onPress={() => {
                  setFavorites((f) => ({ ...f, [asset.id]: !favorite }));
                  void run(() => actions.favorite(serverUrl, [asset.id], !favorite));
                }}
              />
              <ViewerAction
                icon="trash"
                label="Move to trash"
                tint="#fff"
                disabled={busy}
                onPress={() => setTrashing(true)}
              />
            </Animated.View>
          </>
        )}

        <ConfirmSheet
          open={trashing}
          title="Move this to trash?"
          description="It stays in the trash for 30 days, and can be put back from the web app at any point before that."
          confirmLabel="Move to trash"
          onClose={() => setTrashing(false)}
          onConfirm={() => {
            // Nothing left to look at on this page once it is gone.
            void run(() => actions.trash(serverUrl, [asset.id]));
            onClose();
          }}
        />
      </View>
    </Modal>
  );
}

/**
 * One video page, with its own player.
 *
 * The player belongs to the page rather than the viewer because `useVideoPlayer`
 * ties a native player to the component that called it. Pausing on the way out
 * matters: a swiped-past video that keeps its audio running is the single most
 * obvious way a gallery can feel broken.
 */
function VideoPage({
  uri,
  token,
  active,
  width,
  height,
}: {
  uri: string;
  token: string | null;
  active: boolean;
  width: number;
  height: number;
}) {
  const player = useVideoPlayer(
    { uri, headers: token ? { Authorization: `Bearer ${token}` } : undefined },
    (instance) => {
      instance.loop = false;
    },
  );

  useEffect(() => {
    // Read at the moment the page becomes active rather than subscribed to:
    // changing the setting mid-video should not start or stop what is playing.
    if (active && autoplayVideos()) player.play();
    else player.pause();
  }, [active, player]);

  return (
    <VideoView
      player={player}
      style={{ width, height }}
      contentFit="contain"
      nativeControls
      // `allowsFullscreen` is deprecated in expo-video 3; the options object
      // replaces it and the boolean is due to stop working.
      fullscreenOptions={{ enable: true }}
    />
  );
}

function ViewerAction({
  icon,
  label,
  tint,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  tint: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    // A fixed square rather than a flexible column: these sit beside a title
    // that should take whatever width is left, not share it equally.
    <Touchable
      onPress={onPress}
      disabled={disabled}
      radius={radius.pill}
      label={label}
      style={{ width: 40, height: 40 }}
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={tint} />
      </View>
    </Touchable>
  );
}
