import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { autoplayVideos } from '../lib/preferences';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions } from '../lib/actions';
import { ApiError, duration as formatDuration, type Asset } from '../lib/api';
import { ensureFreshToken } from '../lib/auth';
import { colors, radius } from '../theme';
import { useGrowFrom, type Rect } from './grow';
import { Icon, type IconName } from './Icon';
import { ConfirmSheet, VaultSheet } from './sheets';
import { Touchable } from './ui';
import { ZoomableMedia } from './ZoomableMedia';
import {
  clampViewerSafeBottom,
  VIEWER_ACTION_DOCK_HEIGHT,
  VIEWER_FILMSTRIP_HEIGHT,
  VIEWER_HEADER_HEIGHT,
  viewerDockHeight,
  viewerFilmstripBottom,
  viewerMediaBottom,
  viewerMediaViewport,
  viewerVideoControlsBottom,
} from './viewerGeometry';

/**
 * Apple Photos keeps the media frame stable underneath its floating chrome.
 * These measurements are shared by both Imadeo viewers so server and device
 * media occupy the same space and never jump when the controls fade.
 */
/** A modal can inherit the native tab bar's inset; Photos only reserves the
 * physical home-indicator inset inside its own full-screen viewer. */
export const viewerSafeBottom = (safeBottom: number) =>
  clampViewerSafeBottom(safeBottom, Platform.OS === 'ios');

export {
  VIEWER_ACTION_DOCK_HEIGHT,
  VIEWER_FILMSTRIP_HEIGHT,
  VIEWER_HEADER_HEIGHT,
  viewerDockHeight,
  viewerFilmstripBottom,
  viewerMediaViewport,
};

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
  const [scrubbing, setScrubbing] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [vaultPrompt, setVaultPrompt] = useState(false);
  const [pendingLock, setPendingLock] = useState<boolean | null>(null);
  /** Overrides the server's answer for anything favourited in this session. */
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [rotations, setRotations] = useState<Record<string, 0 | 90 | 180 | 270>>({});
  const chromeOpacity = useRef(new Animated.Value(1)).current;
  const currentRef = useRef(current);
  const resuming = useRef(false);

  /** Which page it opened on, kept for the way back out. */
  const opened = useRef(index ?? 0);

  // Opening on the tapped photo rather than the first one. The list is only
  // mounted while the viewer is open, so this runs once per opening.
  useEffect(() => {
    if (index === null) return;
    opened.current = index;
    setCurrent(index);
    setChrome(true);
    setZoomed(false);
    setFavorites({});
    setRotations({});
    setVaultPrompt(false);
    setPendingLock(null);
    setActionError(null);
  }, [index]);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      resuming.current = true;
      requestAnimationFrame(() => {
        list.current?.scrollToOffset({ offset: currentRef.current * width, animated: false });
      });
      settle = setTimeout(() => {
        list.current?.scrollToOffset({ offset: currentRef.current * width, animated: false });
        resuming.current = false;
      }, 250);
    });
    return () => {
      if (settle) clearTimeout(settle);
      subscription.remove();
    };
  }, [width]);

  useEffect(() => {
    Animated.timing(chromeOpacity, {
      toValue: chrome ? 1 : 0,
      duration: chrome ? 180 : 150,
      useNativeDriver: true,
    }).start();
  }, [chrome, chromeOpacity]);

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
  const locked = asset.visibility === 'LOCKED';
  // The media frame never changes when the chrome is shown or hidden. Moving
  // this edge on tap made the photo/video resize and visibly jump.
  const safeBottom = viewerSafeBottom(insets.bottom);
  const mediaViewport = viewerMediaViewport(height, insets.top, safeBottom);
  const mediaTop = mediaViewport.top;
  const mediaHeight = mediaViewport.height;
  const dockHeight = viewerDockHeight(safeBottom);
  const filmstripBottom = viewerFilmstripBottom(safeBottom);
  const chromeEnter = Animated.multiply(chromeOpacity, enter);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const setLock = async (isLocked: boolean) => {
    setBusy(true);
    setActionError(null);
    try {
      await actions.setLock(serverUrl, [asset.id], isLocked);
      onChanged();
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'VAULT_LOCKED') {
        setPendingLock(isLocked);
        setVaultPrompt(true);
      } else {
        setActionError(cause instanceof Error ? cause.message : 'Locked could not be changed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const showAt = (next: number) => {
    const bounded = Math.max(0, Math.min(assets.length - 1, next));
    resuming.current = false;
    setZoomed(false);
    setCurrent(bounded);
    list.current?.scrollToOffset({ offset: bounded * width, animated: true });
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
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
          scrollEnabled={!scrubbing && !zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={opened.current}
          // Every page is exactly the screen's width, so the list never has to
          // measure anything to jump straight to the one that was tapped.
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onScrollBeginDrag={() => {
            resuming.current = false;
          }}
          onMomentumScrollEnd={(event) => {
            if (resuming.current) {
              list.current?.scrollToOffset({ offset: current * width, animated: false });
              return;
            }
            setZoomed(false);
            setCurrent(Math.round(event.nativeEvent.contentOffset.x / width));
          }}
          // Only the visible page and its immediate neighbours stay alive: each
          // video page owns a native player, and a hundred of them would be a
          // hundred decoders.
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          renderItem={({ item, index: i }) => (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
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
                  contentTop={mediaTop}
                  safeBottom={safeBottom}
                  onScrubbingChange={setScrubbing}
                  onZoomChange={setZoomed}
                  onTap={() => setChrome((on) => !on)}
                />
              ) : (
                <View
                  style={{ position: 'absolute', top: mediaTop, left: 0, width, height: mediaHeight }}
                >
                  <ZoomableMedia
                    width={width}
                    height={mediaHeight}
                    active={i === current}
                    accessibilityLabel={item.originalFileName ?? 'Photo'}
                    onTap={() => setChrome((on) => !on)}
                    onZoomChange={setZoomed}
                  >
                    <ServerPhoto
                      serverUrl={serverUrl}
                      token={token}
                      asset={item}
                      width={width}
                      height={mediaHeight}
                      rotation={rotations[item.id] ?? item.rotation ?? 0}
                    />
                  </ZoomableMedia>
                </View>
              )}
            </View>
          )}
        />
        </Animated.View>

        {/* Photos-style chrome is always mounted and only fades. Mounting and
            unmounting it on every tap made the whole screen feel like it was
            being laid out again even after the media bounds were stabilised. */}
        <Animated.View
          pointerEvents={chrome ? 'box-none' : 'none'}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: insets.top + VIEWER_HEADER_HEIGHT,
            opacity: chromeEnter,
          }}
        >
          <View
            style={{
              position: 'absolute',
              top: Math.max(8, insets.top - 1),
              left: 16,
              right: 16,
              height: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                position: 'absolute',
                left: 0,
                width: 44,
                height: 44,
                borderRadius: radius.pill,
                backgroundColor: colors.surface,
              }}
            >
              <Touchable onPress={onClose} radius={radius.pill} label="Close" style={{ flex: 1 }}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="back" size={24} color={colors.text} />
                </View>
              </Touchable>
            </View>

            <View
              pointerEvents="none"
              style={{
                maxWidth: Math.max(160, width - 156),
                minWidth: Math.min(160, width - 156),
                minHeight: 44,
                paddingHorizontal: 16,
                paddingVertical: 5,
                borderRadius: radius.pill,
                backgroundColor: colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
                {asset.originalFileName ?? 'Photo'}
              </Text>
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11.5, marginTop: 1 }}>
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
          </View>
        </Animated.View>

        <Animated.View
          pointerEvents={chrome ? 'box-none' : 'none'}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: filmstripBottom,
            height: VIEWER_FILMSTRIP_HEIGHT,
            opacity: chromeEnter,
          }}
        >
          <ViewerFilmstrip
            items={assets.map((item) => ({
              id: item.id,
              source: {
                uri: `${serverUrl}/api/assets/${item.id}/thumbnail?size=thumb`,
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              },
            }))}
            current={current}
            onSelect={showAt}
          />
        </Animated.View>

        <Animated.View
          pointerEvents={chrome ? 'box-none' : 'none'}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: dockHeight,
            paddingBottom: safeBottom,
            paddingHorizontal: 28,
            backgroundColor: colors.viewer,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            opacity: chromeEnter,
          }}
        >
          <ViewerActionPlate>
            <ViewerAction
              icon="rotate"
              label="Rotate clockwise"
              tint={colors.text}
              disabled={busy}
              onPress={() => {
                const next = ((rotation + 90) % 360) as 0 | 90 | 180 | 270;
                setRotations((current) => ({ ...current, [asset.id]: next }));
                void run(() => actions.rotateAsset(serverUrl, asset.id, next));
              }}
            />
          </ViewerActionPlate>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 8,
              borderRadius: radius.pill,
              backgroundColor: colors.surface,
            }}
          >
            <ViewerAction
              icon={favorite ? 'heart-filled' : 'heart'}
              label={favorite ? 'Remove from favourites' : 'Favourite'}
              tint={favorite ? colors.danger : colors.text}
              disabled={busy}
              onPress={() => {
                setFavorites((f) => ({ ...f, [asset.id]: !favorite }));
                void run(() => actions.favorite(serverUrl, [asset.id], !favorite));
              }}
            />
            <ViewerAction
              icon={locked ? 'unlock' : 'lock'}
              label={locked ? 'Remove from Locked' : 'Move to Locked'}
              tint={colors.text}
              disabled={busy}
              onPress={() => void setLock(!locked)}
            />
          </View>

          <ViewerActionPlate>
            <ViewerAction
              icon="trash"
              label="Move to trash"
              tint={colors.text}
              disabled={busy}
              onPress={() => setTrashing(true)}
            />
          </ViewerActionPlate>
        </Animated.View>

        {chrome && actionError && (
          <Animated.View
            style={{
              position: 'absolute',
              top: mediaTop + 16,
              left: 16,
              right: 16,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: radius.md,
              backgroundColor: colors.overlay,
              opacity: enter,
            }}
          >
            <Text style={{ color: colors.danger, fontSize: 13 }}>{actionError}</Text>
          </Animated.View>
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
        <VaultSheet
          open={vaultPrompt}
          serverUrl={serverUrl}
          onClose={() => {
            setVaultPrompt(false);
            setPendingLock(null);
          }}
          onUnlocked={() => {
            const next = pendingLock;
            setPendingLock(null);
            if (next !== null) void setLock(next);
          }}
        />
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * Shows the ready-to-paint preview first, then cross-fades to the untouched
 * upload once iOS has decoded it. Unsupported originals keep the preview, so
 * RAW formats do not turn a working viewer into a broken-image screen.
 */
function ServerPhoto({
  serverUrl,
  token,
  asset,
  width,
  height,
  rotation,
}: {
  serverUrl: string;
  token: string | null;
  asset: Asset;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}) {
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [originalFailed, setOriginalFailed] = useState(false);
  const quarterTurn = rotation === 90 || rotation === 270;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const mediaStyle = {
    width: quarterTurn ? height : width,
    height: quarterTurn ? width : height,
    transform: [{ rotate: `${rotation}deg` }],
  } as const;

  useEffect(() => {
    setOriginalLoaded(false);
    setOriginalFailed(false);
  }, [asset.id]);

  return (
    <View style={{ width, height }}>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Image
          source={{
            uri: `${serverUrl}/api/assets/${asset.id}/thumbnail?size=preview`,
            headers,
          }}
          style={[mediaStyle, { opacity: originalLoaded ? 0 : 1 }]}
          contentFit="contain"
          transition={140}
          cachePolicy="memory-disk"
          recyclingKey={`${asset.id}-preview`}
        />
      </View>
      {!originalFailed && (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Image
            source={{ uri: `${serverUrl}/api/assets/${asset.id}/original`, headers }}
            style={[mediaStyle, { opacity: originalLoaded ? 1 : 0 }]}
            contentFit="contain"
            transition={180}
            cachePolicy="memory-disk"
            recyclingKey={`${asset.id}-original`}
            onLoad={() => setOriginalLoaded(true)}
            onError={() => setOriginalFailed(true)}
          />
        </View>
      )}
    </View>
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
  contentTop = 0,
  safeBottom = 0,
  onScrubbingChange,
  onZoomChange,
  onTap,
}: {
  uri: string;
  serverUrl?: string;
  token: string | null;
  active: boolean;
  controlsVisible: boolean;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  /** Keeps the media below the viewer toolbar without overlaying it. */
  contentTop?: number;
  /** Keeps interactive controls above the home indicator without shrinking media. */
  safeBottom?: number;
  onScrubbingChange?: (scrubbing: boolean) => void;
  onZoomChange?: (zoomed: boolean) => void;
  onTap?: () => void;
}) {
  const view = useRef<VideoView>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbingTime, setScrubbingTime] = useState<number | null>(null);
  const scrubbing = useRef(false);
  const resumeAfterScrub = useRef(false);
  const pendingScrubTime = useRef<number | null>(null);
  const scrubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const sourceSubscription = player.addListener(
      'sourceLoad',
      ({ duration: next }) => {
        setDuration(next);
      },
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
      // A cache-buster is useful for a server video that may have just finished
      // processing. It makes a local `file://` URL point at a file that does not
      // exist, however, which left every device-library video on "Preparing".
      const sourceUri = serverUrl
        ? `${uri}${uri.includes('?') ? '&' : '?'}playbackAttempt=${attempt}`
        : uri;
      await player.replaceAsync({
        uri: sourceUri,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        // Let Photos describe local MOV/MP4 assets. The server endpoint has no
        // file extension, so it still needs to be identified as progressive.
        contentType: serverUrl ? 'progressive' : 'auto',
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

  const displayedTime = scrubbingTime ?? currentTime;
  const videoTop = Math.max(0, Math.min(contentTop, height));
  const availableHeight = Math.max(1, viewerMediaBottom(height, safeBottom) - videoTop);
  const rotated = rotation === 90 || rotation === 270;

  const seekPreview = (next: number) => {
    setScrubbingTime(next);
    pendingScrubTime.current = next;

    // Keep the thumb and clock immediate, while limiting native seeks to a
    // rate at which the decoder can actually display the requested frames.
    if (scrubTimer.current !== null) return;
    scrubTimer.current = setTimeout(() => {
      scrubTimer.current = null;
      const target = pendingScrubTime.current;
      if (!scrubbing.current || target === null) return;
      player.currentTime = target;
      setCurrentTime(target);
    }, 50);
  };

  const startScrubbing = (next: number) => {
    if (!scrubbing.current) {
      scrubbing.current = true;
      resumeAfterScrub.current = player.playing;
      player.pause();
      player.scrubbingModeOptions = { scrubbingModeEnabled: true };
      player.seekTolerance = { toleranceBefore: 0.35, toleranceAfter: 0.35 };
      onScrubbingChange?.(true);
    }
    seekPreview(next);
  };

  const finishScrubbing = (next: number) => {
    if (scrubTimer.current !== null) {
      clearTimeout(scrubTimer.current);
      scrubTimer.current = null;
    }
    pendingScrubTime.current = null;
    player.currentTime = next;
    setCurrentTime(next);
    setScrubbingTime(null);
    player.scrubbingModeOptions = { scrubbingModeEnabled: false };
    player.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
    scrubbing.current = false;
    onScrubbingChange?.(false);
    if (resumeAfterScrub.current && active) player.play();
    resumeAfterScrub.current = false;
  };

  useEffect(() => () => {
    if (scrubTimer.current !== null) clearTimeout(scrubTimer.current);
    // `useVideoPlayer` owns and releases the native player during unmount.
    // Never write to that shared object from a React cleanup: on iOS Expo may
    // already have released it, which throws NotFoundException and crashes the
    // viewer as a video page is virtualised or closed.
    onScrubbingChange?.(false);
  }, [onScrubbingChange]);

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: videoTop,
          bottom: 0,
          left: 0,
          width,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 0,
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width,
            height: availableHeight,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ZoomableMedia
            width={width}
            height={availableHeight}
            active={active}
            accessibilityLabel="Video"
            onTap={onTap}
            onZoomChange={onZoomChange}
          >
            <VideoView
              ref={view}
              player={player}
              style={{
                width: rotated ? availableHeight : width,
                height: rotated ? width : availableHeight,
                transform: [{ rotate: `${rotation}deg` }],
              }}
              contentFit="contain"
              nativeControls={false}
              fullscreenOptions={{ enable: true }}
            />
          </ZoomableMedia>

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
                {status === 'error'
                  ? serverUrl
                    ? 'Preparing this video…'
                    : 'This video could not be opened.'
                  : 'Loading video…'}
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
        </View>

      {controlsVisible && <View
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          // The timeline belongs above the filmstrip and action dock, exactly
          // where Photos places it. Every one of those layers is absolute, so
          // showing the chrome never changes the video's measured rectangle.
          bottom: viewerVideoControlsBottom(safeBottom),
          zIndex: 2,
          minHeight: 48,
          paddingHorizontal: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
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
            <Icon name={playing ? 'pause' : 'play'} size={19} color={colors.text} />
          </View>
        </Touchable>

        <Text style={{ width: 38, textAlign: 'right', color: colors.text, fontSize: 11 }}>
          {clockTime(displayedTime)}
        </Text>
        <VideoSeekBar
          value={displayedTime}
          duration={duration}
          onScrubStart={startScrubbing}
          onScrubMove={seekPreview}
          onScrubEnd={finishScrubbing}
        />
        <Text style={{ width: 38, color: colors.text, fontSize: 11 }}>{clockTime(duration)}</Text>

        <Touchable
          onPress={() => void view.current?.enterFullscreen()}
          radius={radius.pill}
          label="Full screen"
          style={{ width: 38, height: 38 }}
        >
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="fullscreen" size={20} color={colors.text} />
          </View>
        </Touchable>
      </View>}
      </View>
    </View>
  );
}

function VideoSeekBar({
  value,
  duration,
  onScrubStart,
  onScrubMove,
  onScrubEnd,
}: {
  value: number;
  duration: number;
  onScrubStart: (value: number) => void;
  onScrubMove: (value: number) => void;
  onScrubEnd: (value: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const lastValue = useRef(0);
  const progress = duration > 0 ? Math.max(0, Math.min(value / duration, 1)) : 0;
  const positionFor = (locationX: number) => {
    if (!duration || !width) return null;
    return Math.max(0, Math.min(duration, (locationX / width) * duration));
  };
  const valueAt = (locationX: number) => {
    const next = positionFor(locationX);
    if (next === null) return null;
    lastValue.current = next;
    return next;
  };

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="Video position"
      accessibilityValue={{
        min: 0,
        max: Math.max(0, Math.round(duration)),
        now: Math.max(0, Math.round(value)),
        text: `${clockTime(value)} of ${clockTime(duration)}`,
      }}
      accessibilityActions={[
        { name: 'decrement', label: 'Back 5 seconds' },
        { name: 'increment', label: 'Forward 5 seconds' },
      ]}
      onAccessibilityAction={(event) => {
        const offset = event.nativeEvent.actionName === 'increment' ? 5 : -5;
        const next = Math.max(0, Math.min(duration, value + offset));
        onScrubStart(next);
        onScrubEnd(next);
      }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => duration > 0}
      onStartShouldSetResponderCapture={() => duration > 0}
      onMoveShouldSetResponder={() => duration > 0}
      onMoveShouldSetResponderCapture={() => duration > 0}
      onResponderGrant={(event) => {
        const next = valueAt(event.nativeEvent.locationX);
        if (next !== null) onScrubStart(next);
      }}
      onResponderMove={(event) => {
        const next = valueAt(event.nativeEvent.locationX);
        if (next !== null) onScrubMove(next);
      }}
      onResponderRelease={(event) => {
        const next = positionFor(event.nativeEvent.locationX) ?? lastValue.current;
        onScrubEnd(next);
      }}
      onResponderTerminate={() => onScrubEnd(lastValue.current)}
      onResponderTerminationRequest={() => false}
      style={{ flex: 1, height: 44, justifyContent: 'center' }}
    >
      <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.border }}>
        <View
          style={{
            width: `${progress * 100}%`,
            height: 3,
            borderRadius: 2,
            backgroundColor: colors.primary,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: `${progress * 100}%`,
            top: -5,
            width: 13,
            height: 13,
            marginLeft: -6.5,
            borderRadius: 7,
            backgroundColor: colors.primary,
          }}
        />
      </View>
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

interface ViewerFilmstripItem {
  id: string;
  source: string | { uri: string; headers?: Record<string, string> };
}

/** The centred strip Photos uses to preserve context while paging media. */
export function ViewerFilmstrip({
  items,
  current,
  onSelect,
}: {
  items: ViewerFilmstripItem[];
  current: number;
  onSelect: (index: number) => void;
}) {
  const strip = useRef<FlatList<ViewerFilmstripItem>>(null);

  useEffect(() => {
    if (!items[current]) return;
    strip.current?.scrollToIndex({ index: current, animated: true, viewPosition: 0.5 });
  }, [current, items.length]);

  return (
    <FlatList
      ref={strip}
      horizontal
      data={items}
      keyExtractor={(item) => item.id}
      showsHorizontalScrollIndicator={false}
      initialScrollIndex={Math.max(0, Math.min(current, items.length - 1))}
      getItemLayout={(_data, index) => ({ length: 40, offset: index * 40, index })}
      onScrollToIndexFailed={({ index }) => {
        strip.current?.scrollToOffset({ offset: Math.max(0, index * 40), animated: false });
      }}
      contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'center' }}
      renderItem={({ item, index }) => (
        <Touchable
          onPress={() => onSelect(index)}
          radius={radius.sm}
          label={`Show item ${index + 1}`}
          style={{ width: 40, height: VIEWER_FILMSTRIP_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
        >
          <Image
            source={item.source}
            style={{
              width: index === current ? 32 : 28,
              height: index === current ? 38 : 34,
              borderRadius: radius.sm,
              borderWidth: index === current ? 2 : 0,
              borderColor: colors.primary,
              backgroundColor: colors.raised,
            }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={`viewer-strip-${item.id}`}
          />
        </Touchable>
      )}
    />
  );
}

function ViewerActionPlate({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        width: 48,
        height: 48,
        borderRadius: radius.pill,
        backgroundColor: colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
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
