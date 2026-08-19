import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { autoplayVideos } from '../lib/preferences';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { ensureFreshToken } from '../lib/auth';
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
  const [rotations, setRotations] = useState<Record<string, 0 | 90 | 180 | 270>>({});

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
    setRotations({});
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
  const rotation = rotations[asset.id] ?? asset.rotation ?? 0;

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
                  serverUrl={serverUrl}
                  token={token}
                  active={i === current}
                  controlsVisible={chrome && i === current}
                  width={width}
                  height={height}
                  rotation={rotations[item.id] ?? item.rotation ?? 0}
                />
              ) : (
                <Image
                  source={{
                    uri: `${serverUrl}/api/assets/${item.id}/thumbnail?size=preview`,
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                  }}
                  style={{
                    width:
                      (rotations[item.id] ?? item.rotation) === 90 ||
                      (rotations[item.id] ?? item.rotation) === 270
                        ? height
                        : width,
                    height:
                      (rotations[item.id] ?? item.rotation) === 90 ||
                      (rotations[item.id] ?? item.rotation) === 270
                        ? width
                        : height,
                    transform: [
                      { rotate: `${rotations[item.id] ?? item.rotation ?? 0}deg` },
                    ],
                  }}
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
                icon="rotate"
                label="Rotate clockwise"
                tint="#fff"
                disabled={busy}
                onPress={() => {
                  const next = ((rotation + 90) % 360) as 0 | 90 | 180 | 270;
                  setRotations((current) => ({ ...current, [asset.id]: next }));
                  void run(() => actions.rotateAsset(serverUrl, asset.id, next));
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
export function VideoPage({
  uri,
  serverUrl,
  token,
  active,
  controlsVisible,
  width,
  height,
  rotation,
}: {
  uri: string;
  serverUrl?: string;
  token: string | null;
  active: boolean;
  controlsVisible: boolean;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}) {
  const view = useRef<VideoView>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progressWidth, setProgressWidth] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'readyToPlay' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.25;
  });

  useEffect(() => {
    const playingSubscription = player.addListener('playingChange', ({ isPlaying }) =>
      setPlaying(isPlaying),
    );
    const timeSubscription = player.addListener('timeUpdate', ({ currentTime: next }) =>
      setCurrentTime(next),
    );
    const sourceSubscription = player.addListener('sourceLoad', ({ duration: next }) =>
      setDuration(next),
    );
    const statusSubscription = player.addListener('statusChange', ({ status: next }) =>
      setStatus(next),
    );
    setCurrentTime(player.currentTime);
    setDuration(player.duration);
    return () => {
      playingSubscription.remove();
      timeSubscription.remove();
      sourceSubscription.remove();
      statusSubscription.remove();
    };
  }, [player]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setStatus('loading');
    setCurrentTime(0);
    setDuration(0);

    const load = async () => {
      const accessToken = serverUrl ? await ensureFreshToken(serverUrl) : token;
      if (!alive) return;
      const separator = uri.includes('?') ? '&' : '?';
      await player.replaceAsync({
        uri: `${uri}${separator}playbackAttempt=${attempt}`,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        contentType: 'progressive',
      });
    };

    void load().catch(() => {
      if (alive) setStatus('error');
    });
    return () => {
      alive = false;
    };
  }, [active, attempt, player, serverUrl, uri]);

  // A video can be opened before its compatible copy is ready. Keep the page
  // alive and pick it up automatically when background processing finishes.
  useEffect(() => {
    if (!active || status !== 'error' || !serverUrl) return;
    const timer = setTimeout(() => setAttempt((value) => value + 1), 10_000);
    return () => clearTimeout(timer);
  }, [active, serverUrl, status]);

  useEffect(() => {
    // Read at the moment the page becomes active rather than subscribed to:
    // changing the setting mid-video should not start or stop what is playing.
    if (active && status === 'readyToPlay' && autoplayVideos()) player.play();
    else player.pause();
  }, [active, player, status]);

  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <VideoView
        ref={view}
        player={player}
        style={{
          width: rotation === 90 || rotation === 270 ? height : width,
          height: rotation === 90 || rotation === 270 ? width : height,
          transform: [{ rotate: `${rotation}deg` }],
        }}
        contentFit="contain"
        nativeControls={false}
        fullscreenOptions={{ enable: true }}
      />

      {status !== 'readyToPlay' && (
        <View
          style={{
            position: 'absolute',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 22,
            paddingVertical: 18,
            borderRadius: radius.lg,
            backgroundColor: colors.overlay,
          }}
        >
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
            {status === 'error' ? 'Preparing this video…' : 'Loading video…'}
          </Text>
          {status === 'error' && (
            <Touchable
              onPress={() => setAttempt((value) => value + 1)}
              radius={radius.pill}
              label="Try video again"
              style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface }}
            >
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>Try again</Text>
            </Touchable>
          )}
        </View>
      )}

      {controlsVisible && <View
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 28,
          minHeight: 54,
          paddingHorizontal: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderRadius: radius.md,
          backgroundColor: colors.overlay,
        }}
      >
        <Touchable
          onPress={() => {
            if (status !== 'readyToPlay') setAttempt((value) => value + 1);
            else if (playing) player.pause();
            else if (duration > 0 && currentTime >= duration - 0.05) player.replay();
            else player.play();
          }}
          radius={radius.pill}
          label={playing ? 'Pause' : 'Play'}
          style={{ width: 38, height: 38 }}
        >
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={playing ? 'pause' : 'play'} size={19} color="#fff" />
          </View>
        </Touchable>

        <Text style={{ width: 38, textAlign: 'right', color: '#fff', fontSize: 11 }}>
          {clockTime(currentTime)}
        </Text>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Video position"
          onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}
          onPress={(event) => {
            if (!duration || !progressWidth) return;
            const next = Math.max(
              0,
              Math.min(duration, (event.nativeEvent.locationX / progressWidth) * duration),
            );
            player.currentTime = next;
            setCurrentTime(next);
          }}
          style={{ flex: 1, height: 38, justifyContent: 'center' }}
        >
          <View style={{ height: 3, overflow: 'hidden', borderRadius: 2, backgroundColor: colors.border }}>
            <View style={{ width: `${progress * 100}%`, height: 3, backgroundColor: colors.primary }} />
          </View>
        </Pressable>
        <Text style={{ width: 38, color: '#fff', fontSize: 11 }}>{clockTime(duration)}</Text>

        <Touchable
          onPress={() => void view.current?.enterFullscreen()}
          radius={radius.pill}
          label="Full screen"
          style={{ width: 38, height: 38 }}
        >
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="fullscreen" size={20} color="#fff" />
          </View>
        </Touchable>
      </View>}
    </View>
  );
}

function clockTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
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
