import { Image } from 'expo-image';
/*
 * The legacy entry, deliberately.
 *
 * SDK 57 rewrote this module: an `Asset` is now an object of getters
 * (`getCreationTime`, `getMediaType`) rather than plain fields, and `SortBy`
 * has gone from the main export. That is a migration of its own — the backup
 * engine and the device grid both read these fields all over — and it does not
 * belong in the middle of a navigation migration. `expo-file-system` is
 * imported the same way here for the same reason.
 */
import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Dimensions,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Empty } from '../components/AssetGrid';
import { BackupProgressScreen } from './BackupProgressScreen';
import { HeaderAction, useHeaderClearance } from '../components/Header';
import { useHeaderSlot } from '../header';
import { intoDays } from '../lib/day';
import { Icon } from '../components/Icon';
import { DeviceActions } from '../components/PhotoActions';
import { ConfirmSheet } from '../components/sheets';
import { Button, Touchable } from '../components/ui';
import { isEnabled } from '../lib/autobackup';
import { backupInFlight, pendingCount, runBackup, uploadedIds, type Progress } from '../lib/backup';
import { useSelectionBar } from '../selection';
import { colors, radius, TAB_BAR_CLEARANCE } from '../theme';

interface Props {
  serverUrl: string;
}

const PAGE = 120;
const COLUMNS = 3;

/**
 * The day a photo was taken, written the way someone would say it.
 *
 * Today and Yesterday by name, the rest by date — and the year only once it is
 * not this one, because "12 March" reads faster than "12 March 2026" and the
 * year is only news when it is a different one.
 */
/** Cut into days, with each day already split into rows of `COLUMNS`. */
const byDay = (assets: MediaLibrary.Asset[]) =>
  intoDays(assets, (asset) => asset.creationTime, COLUMNS);

/**
 * What is on this phone.
 *
 * The device's own camera roll, and how much of it has reached the server. The
 * server's copy lives under Imadeo — this screen is deliberately the local one,
 * so "is this photo safe yet" has an answer without leaving the first tab.
 *
 * Backup runs in the foreground only on both platforms: a run continues while
 * this screen is open and resumes from where it stopped next time.
 */
export function LibraryScreen({ serverUrl }: Props) {
  /**
   * Photos and videos only.
   *
   * Left to itself the module asks for all three granular Android permissions,
   * audio included. A backup app asking for the music library is both wrong and
   * a good reason to tap Deny — and on Android 13+ a denial covers the whole
   * request, so the audio prompt was taking photo access down with it.
   */
  const [permission, requestPermission, checkPermission] = MediaLibrary.usePermissions({
    granularPermissions: ['photo', 'video'],
  });
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which of these tiles the server already holds, for the tick in the corner. */
  const [uploaded, setUploaded] = useState<Set<string>>(new Set());
  /**
   * Hand-picked assets to send. Empty means no selection is in progress and the
   * button backs up everything outstanding, which is the common case.
   */
  const [picked, setPicked] = useState<string[]>([]);
  /** The device photo open full screen, if any. Declared with the other state
      rather than beside the list, which is below the permission gate's early
      return. */
  const [viewing, setViewing] = useState<MediaLibrary.Asset | null>(null);
  /** The per-item backup list, opened from the progress bar. */
  const [showProgress, setShowProgress] = useState(false);
  /** Set while the "remove from this phone" confirmation is up. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Whether a run is in flight. `progress` outlives it, as the last account. */
  const [running, setRunning] = useState(false);
  /** Read inside the upload loop, so Stop takes effect on the next item. */
  const stop = useRef(false);

  const clearance = useHeaderClearance(0);
  const selectionBar = useSelectionBar();

  const load = useCallback(async () => {
    // Limited access still reads — of the subset that was shared.
    if (!permission?.granted && permission?.accessPrivileges !== 'limited') return;
    setLoading(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: PAGE,
        mediaType: ['photo', 'video'],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });
      setAssets(page.assets);
      setTotal(page.totalCount);
      // Both go through the server so a fresh install does not report a phone
      // full of photos as un-backed-up when they are all already there.
      setPending(await pendingCount(serverUrl));
      setUploaded(await uploadedIds(serverUrl));
    } finally {
      setLoading(false);
    }
  }, [permission?.granted, permission?.accessPrivileges, serverUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Picking "Select photos" is granting access, not refusing it.
   *
   * Both platforms let someone hand over a chosen subset instead of the whole
   * library, and that answer comes back as `granted: false` with
   * `accessPrivileges: 'limited'`. Reading only `granted` shut those people out
   * of the app entirely and told them to go and enable a permission they had
   * just enabled. Imadeo can back up whatever it is shown; how much that is, is
   * their business, and the note further down says how much it turned out to be.
   */
  const allowed = permission?.granted || permission?.accessPrivileges === 'limited';

  // A null permission means the check has not settled. It is treated as "not
  // granted" rather than shown as a spinner: on Android it can stay null
  // indefinitely, and an endless spinner is worse than a prompt that works.
  const backedUp = pending === 0;
  const host = serverUrl.replace(/^https?:\/\//, '');

  /** Start, or stop what is already running. */
  const backUp = async () => {
    if (running) {
      // Already running: this press is a stop.
      stop.current = true;
      return;
    }
    const only = picked.length > 0 ? picked : undefined;
    stop.current = false;
    setError(null);
    setRunning(true);
    setProgress({ done: 0, total: 0, failed: 0, held: 0, queue: [], at: -1, sent: [], failures: [] });
    try {
      await runBackup(serverUrl, setProgress, () => stop.current, only);
      setPending(await pendingCount(serverUrl));
      setUploaded(await uploadedIds(serverUrl));
      setPicked([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed.');
    } finally {
      /**
       * The run stops; its record does not.
       *
       * `progress` used to be thrown away here, which meant the moment a backup
       * finished there was no longer anywhere to see which photos had failed —
       * exactly when someone wants to look. `running` says whether anything is
       * in flight; `progress` is the last run's account of itself.
       */
      setRunning(false);
    }
  };

  /*
   * Kept in refs because the listener below is registered once and would
   * otherwise be holding the first render's `backUp` and the first render's
   * idea of whether anything was running.
   */
  const backUpRef = useRef(backUp);
  backUpRef.current = backUp;
  const runningRef = useRef(running);
  runningRef.current = running;

  /**
   * A run when the app arrives at the front, if automatic backup is on.
   *
   * Neither platform will wake an app because a photo was taken, so the moment
   * someone opens Imadeo is the best chance the phone has had in hours to catch
   * up — and it is also the moment they are most likely to be wondering whether
   * it did. The background task keeps its own schedule; this is the other half
   * of the same setting.
   *
   * Not while one is already going: `backUp` reads a second press as a stop, so
   * calling it on resume mid-run would cancel the very thing it is there to
   * finish.
   */
  useEffect(() => {
    if (!allowed) return;

    let alive = true;
    const catchUp = async () => {
      if (!alive || runningRef.current || backupInFlight()) return;
      if (!(await isEnabled())) return;
      if (!alive || runningRef.current || backupInFlight()) return;
      void backUpRef.current();
    };

    void catchUp();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void catchUp();
    });

    return () => {
      alive = false;
      subscription.remove();
    };
  }, [allowed]);

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id],
    );

  /**
   * Frees space on the phone, and only on the phone.
   *
   * Kept well away from the backup path: what this deletes is the copy in the
   * camera roll, and the copy on the server is what makes that safe to do. The
   * upload log is left alone deliberately — those photos are still backed up,
   * and forgetting them would only offer to re-upload files that no longer
   * exist.
   *
   * The OS asks its own question on top of ours; on iOS it must, and there is no
   * way to delete without it.
   */
  const removeFromPhone = async () => {
    setError(null);
    try {
      const removed = await MediaLibrary.deleteAssetsAsync(picked);
      // Declining the system prompt is an answer, not a failure.
      if (!removed) return;
      setPicked([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove those from this phone.');
    }
  };

  /** Of what is picked, how much is not already on the server. */
  const pickedPending = picked.filter((id) => !uploaded.has(id)).length;

  const sections = byDay(assets);

  // The bar is the shell's; this only says what goes in it, so a swipe between
  // tabs never moves it.
  useHeaderSlot(
    'library',
    {
      title: picked.length > 0 ? `${picked.length} selected` : 'Library',
      icon: 'phone',
      subtitle:
        running && progress
          ? `${progress.done} of ${progress.total} sent to ${host}`
          : picked.length > 0
            ? pickedPending === 0
              ? 'Already backed up · tap to change'
              : `${pickedPending.toLocaleString()} to send to ${host}`
            : total === null
              ? 'Reading this phone…'
              : backedUp
                ? `${total.toLocaleString()} on this phone · all backed up`
                : `${total.toLocaleString()} on this phone · ${pending === null ? 'checking' : `${pending.toLocaleString()} to back up`}`,
      /*
       * Nothing to send means no button. Re-reading the phone is what pulling
       * the grid down already does, so a control that only did that was
       * offering a second way to do nothing in particular. A selection has its
       * verbs in the bar at the bottom instead, near the thumb.
       */
      action: running ? (
        <HeaderAction label="Stop" icon="close" onPress={() => void backUp()} />
      ) : picked.length > 0 || backedUp ? undefined : (
        <HeaderAction label="Back up" icon="backup" onPress={() => void backUp()} />
      ),
      below:
        running && progress && progress.total > 0 ? (
          /*
            Inset from the bar's edges rather than run to them.

            It used to sit flush along the bottom, which is exactly where the
            bar's rounded corners are — so the last few percent at each end was
            clipped away and the track looked broken before it had started.
          */
          <Touchable
            onPress={() => setShowProgress(true)}
            label="See what is being backed up"
            radius={radius.pill}
            style={{
              height: 4,
              marginHorizontal: 16,
              marginBottom: 12,
              borderRadius: radius.pill,
              backgroundColor: colors.border,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: '100%',
                width: `${Math.round((progress.done / progress.total) * 100)}%`,
                borderRadius: radius.pill,
                backgroundColor: colors.primary,
              }}
            />
          </Touchable>
        ) : undefined,
    },
    [picked.length, pickedPending, running, progress, total, pending, backedUp, host],
  );

  /*
   * The gate stands here, below every hook.
   *
   * It used to come first, which meant `useHeaderSlot` ran only once access had
   * been granted — a hook called on some renders and not others, which React
   * ends the render over. Nothing above this line does any work worth skipping.
   */
  if (!allowed) {
    return (
      <AskForAccess
        permission={permission}
        onRequest={requestPermission}
        onRecheck={checkPermission}
      />
    );
  }


  /**
   * Every photo taken on one day, in one tap.
   *
   * A day is the unit people actually think in — "back up yesterday", "clear
   * the wedding off my phone" — and reaching it by tapping forty tiles is the
   * kind of thing that makes someone give up halfway. Tapping again lets the
   * day go, so it is a toggle rather than a one-way door.
   */
  const idsOf = (rows: MediaLibrary.Asset[][]) => rows.flat().map((asset) => asset.id);

  const toggleDay = (rows: MediaLibrary.Asset[][]) => {
    const ids = idsOf(rows);
    setPicked((current) => {
      const chosen = new Set(current);
      const all = ids.every((id) => chosen.has(id));
      for (const id of ids) {
        if (all) chosen.delete(id);
        else chosen.add(id);
      }
      return [...chosen];
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/*
        Backing up is the one thing this screen is for, so it lives in the bar
        rather than in a card the grid scrolls away. A card meant the button
        left the screen exactly when a run was worth watching, and it cost a
        third of the first screenful before a single photo was visible.
      */}
      <SectionList
        sections={sections}
        keyExtractor={(row) => row[0].id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingTop: clearance, paddingBottom: TAB_BAR_CLEARANCE }}
        renderSectionHeader={({ section }) => {
          const ids = idsOf(section.data);
          const allPicked = ids.length > 0 && ids.every((id) => picked.includes(id));

          return (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                // Flush with the tiles below, which sit at the screen edge with
                // only their 1px gutter. An inset here left the date floating
                // away from the photos it belongs to.
                paddingLeft: 2,
                paddingRight: 2,
                paddingTop: 16,
                paddingBottom: 4,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  color: colors.text,
                  fontSize: 15,
                  fontWeight: '700',
                  letterSpacing: -0.3,
                }}
              >
                {section.title}
              </Text>

              <Touchable
                onPress={() => toggleDay(section.data)}
                radius={radius.pill}
                label={allPicked ? `Deselect ${section.title}` : `Select all of ${section.title}`}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: radius.pill,
                    backgroundColor: allPicked ? colors.primary : 'transparent',
                  }}
                >
                  <Icon
                    name={allPicked ? 'check' : 'done'}
                    size={13}
                    color={allPicked ? colors.bg : colors.muted}
                    strong
                  />
                  <Text
                    style={{
                      color: allPicked ? colors.bg : colors.muted,
                      fontSize: 12.5,
                      fontWeight: '700',
                    }}
                  >
                    {allPicked ? 'Selected' : 'Select all'}
                  </Text>
                </View>
              </Touchable>
            </View>
          );
        }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
            progressViewOffset={clearance}
          />
        }
        ListHeaderComponent={
          error || progress?.failed || permission.accessPrivileges === 'limited' ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 8 }}>
              {error && <Text style={{ color: colors.danger, fontSize: 13.5 }}>{error}</Text>}

              {/*
                The way back into the run's account once it has finished.

                The progress bar is the other way in, and it is only on screen
                while something is uploading — which is the one time nobody
                needs to go looking for what went wrong.
              */}
              {progress && progress.failed > 0 && (
                <Touchable
                  onPress={() => setShowProgress(true)}
                  radius={radius.sm}
                  label="See which photos failed"
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
                    <Text style={{ color: colors.faint, fontSize: 12.5, flex: 1 }}>
                      {progress.failed} could not be sent. They stay queued for next time.
                    </Text>
                    <Icon name="forward" size={13} color={colors.faint} />
                  </View>
                </Touchable>
              )}

              {/* Both platforms allow granting a hand-picked subset. Someone in
                  that state sees a count far below what they expect, so it has
                  to be named rather than left looking like a bug. */}
              {permission.accessPrivileges === 'limited' && (
                <Text style={{ color: colors.faint, fontSize: 12.5, lineHeight: 19 }}>
                  You have shared only selected photos with Imadeo. It can back
                  up those, and nothing else, until you widen access in Settings.
                </Text>
              )}
            </View>
          ) : null
        }
        renderItem={({ item: row }) => (
          <View style={{ flexDirection: 'row' }}>
            {row.map((item) => (
              <Tile
                key={item.id}
                asset={item}
                on={picked.includes(item.id)}
                sent={uploaded.has(item.id)}
                selecting={picked.length > 0}
                onToggle={toggle}
                onOpen={setViewing}
              />
            ))}
            {/* Keeps a day's last row aligned with the ones above it rather
                than stretching two photos across the full width. */}
            {row.length < COLUMNS &&
              Array.from({ length: COLUMNS - row.length }).map((_, index) => (
                <View key={`gap-${index}`} style={{ flex: 1 / COLUMNS }} />
              ))}
          </View>
        )}
        ListEmptyComponent={
          loading ? null : (
            <Empty
              icon="phone"
              title="No photos on this phone"
              body="Anything you take from now on will show up here, ready to send to your server."
            />
          )
        }
      />

      {/*
        The device photo, full screen.

        Its own viewer rather than the one in AssetGrid: that one addresses the
        server by asset id and token, and these files have neither — they are
        local `ph://` references the Photos framework resolves.
      */}
      <Modal
        visible={viewing !== null}
        animationType="fade"
        onRequestClose={() => setViewing(null)}
        // Opaque, not transparent: the viewer fills the screen with black
        // anyway, and a transparent window let the tab bar underneath composite
        // faintly over the photograph.
        statusBarTranslucent
      >
        {viewing && (
          <DeviceViewer
            assets={assets}
            start={assets.findIndex((asset) => asset.id === viewing.id)}
            onClose={() => setViewing(null)}
          />
        )}
      </Modal>

      {/*
        The per-item account of the run.

        A modal rather than a pushed screen because it belongs to this tab's
        state — the run is owned here, and routing it through the navigation
        stack would mean lifting the whole backup into a context so a sibling
        screen could read it.
      */}
      <Modal
        visible={showProgress}
        animationType="slide"
        onRequestClose={() => setShowProgress(false)}
        statusBarTranslucent
      >
        <BackupProgressScreen progress={progress} onBack={() => setShowProgress(false)} />
      </Modal>

      {/* Selecting swaps the tabs for what can be done with what is picked,
          which is the one moment the tabs are not what the next tap is for. */}
      <DeviceActions
        ids={picked}
        pending={pickedPending}
        busy={running}
        onClear={() => setPicked([])}
        onBackUp={() => void backUp()}
        onRemove={() => setConfirmDelete(true)}
      />

      {/* Says plainly which copy goes. The whole point of backing up is that the
          phone is not the only place these live, and someone clearing space
          needs to be sure that is what they are doing. */}
      <ConfirmSheet
        open={confirmDelete}
        title={`Remove ${picked.length} ${picked.length === 1 ? 'item' : 'items'} from this phone?`}
        description={
          pickedPending > 0
            ? `${pickedPending} of these have not been backed up yet — those copies would be gone for good. Everything already sent stays on ${host}; only the copy in this phone's gallery is removed.`
            : `They stay on ${host}. Only the copy in this phone's gallery is removed, and you can still see them in Browse.`
        }
        confirmLabel="Remove from phone"
        onConfirm={() => void removeFromPhone()}
        onClose={() => setConfirmDelete(false)}
      />
    </View>
  );
}

/**
 * The device library, full screen, one photo per page.
 *
 * A `FlatList` rather than a single image, because a photo viewer that cannot
 * be swiped is not a viewer — it is a preview you have to back out of to see
 * the next thing. Paged horizontally, opening on whichever tile was tapped.
 *
 * Only the pages either side are rendered: a phone with ten thousand photos
 * would otherwise mount ten thousand images the moment one is opened.
 */
function DeviceViewer({
  assets,
  start,
  onClose,
}: {
  assets: MediaLibrary.Asset[];
  start: number;
  onClose: () => void;
}) {
  /*
   * Measured straight from the window, not through the hook.
   *
   * `useWindowDimensions` inside this modal came back before the modal's own
   * window had been laid out, so the pages were sized zero: nothing painted
   * except the counter, which is absolutely positioned and escaped the
   * collapse, and the tab underneath showed through where the photograph
   * should have been.
   */
  const { width, height } = Dimensions.get('window');
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState(Math.max(0, start));

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.viewer }]}>
      <FlatList
        data={assets}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(asset) => asset.id}
        initialScrollIndex={Math.max(0, start)}
        // Every page is exactly the screen's width, so the list never has to
        // measure anything to know where a given photo starts.
        getItemLayout={(_data, index) => ({ length: width, offset: width * index, index })}
        onMomentumScrollEnd={(event) =>
          setAt(Math.round(event.nativeEvent.contentOffset.x / width))
        }
        windowSize={3}
        renderItem={({ item }) => (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            style={{ width, height, justifyContent: 'center' }}
          >
            <Image
              source={item.uri}
              style={{ width, height }}
              contentFit="contain"
              recyclingKey={item.id}
              transition={140}
            />
          </Pressable>
        )}
      />

      {/* Where you are in the roll, which a paged viewer otherwise never says. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 8,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
        pointerEvents="none"
      >
        <Text
          style={{
            color: '#fff',
            fontSize: 13,
            fontWeight: '700',
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderRadius: radius.pill,
            backgroundColor: colors.overlay,
            overflow: 'hidden',
          }}
        >
          {at + 1} of {assets.length}
        </Text>
      </View>
    </View>
  );
}

/** One photo in the device grid. */
function Tile({
  asset: item,
  on,
  sent,
  selecting,
  onToggle,
  onOpen,
}: {
  asset: MediaLibrary.Asset;
  on: boolean;
  sent: boolean;
  selecting: boolean;
  onToggle: (id: string) => void;
  onOpen: (asset: MediaLibrary.Asset) => void;
}) {
  return (
          <Pressable
            // Long-press opens selection, exactly as it does in the server grid;
            // once anything is picked a plain tap adds to it rather than needing
            // the gesture again.
            onPress={() => (selecting ? onToggle(item.id) : onOpen(item))}
            onLongPress={() => onToggle(item.id)}
            delayLongPress={280}
            accessibilityRole={selecting ? 'checkbox' : 'image'}
            accessibilityLabel={`${item.filename}${sent ? ', backed up' : ''}`}
            accessibilityState={selecting ? { checked: on } : undefined}
            style={{ flex: 1 / COLUMNS, aspectRatio: 1, padding: 1 }}
          >
            {/* Inset while selected, matching the server grid so the two read as
                the same gesture. */}
            <View
              style={{
                flex: 1,
                padding: on ? 5 : 0,
                backgroundColor: on ? colors.primary : 'transparent',
                borderRadius: on ? radius.sm : 0,
              }}
            >
              {/* One image for everything. expo-image reads a ph:// asset
                  directly and asks the Photos framework for the thumbnail iOS
                  has already generated — including for videos, which is why no
                  decoding is needed here at all. */}
              <Image
                source={item.uri}
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

            {/* Already on the server. A mark rather than a dimmed tile: these
                are the photos that are safe, and fading them would read as the
                opposite. Drawn white with a shadow like the video marker,
                because it sits directly on the photograph. */}
            {sent && !on && (
              <View
                style={{
                  position: 'absolute',
                  right: 5,
                  bottom: 5,
                  shadowColor: '#000',
                  shadowOpacity: 0.6,
                  shadowRadius: 3,
                  shadowOffset: { width: 0, height: 0 },
                }}
              >
                <Icon name="cloud-done" size={15} color="#fff" strong />
              </View>
            )}

            {/* Bottom left, out of the cloud's corner. */}
            {item.mediaType === 'video' && !on && (
              <View
                style={{
                  position: 'absolute',
                  left: 5,
                  bottom: 5,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Icon name="play" size={11} color="#fff" />
                <Text
                  style={{
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: '600',
                    textShadowColor: 'rgba(0,0,0,0.6)',
                    textShadowRadius: 3,
                  }}
                >
                  {Math.round(item.duration)}s
                </Text>
              </View>
            )}
          </Pressable>
  );
}

/**
 * The permission gate.
 *
 * Two states, and both are written from the phone's side of the screen. What
 * stands between Imadeo and the camera roll — which build this is, which
 * Android version, which manifest declares what — is the developer's problem
 * and appears nowhere here. Somebody using the app has one question, whether
 * their photos can be backed up, and one place to answer it.
 */
function AskForAccess({
  permission,
  onRequest,
  onRecheck,
}: {
  permission: MediaLibrary.PermissionResponse | null;
  onRequest: () => Promise<MediaLibrary.PermissionResponse>;
  onRecheck: () => Promise<MediaLibrary.PermissionResponse>;
}) {
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState(false);

  /**
   * Asks the system again every time the app comes back to the front.
   *
   * The whole point of the Settings button is that the answer changes while
   * Imadeo is in the background — and nothing was re-reading it, so granting
   * access and switching back left this screen still insisting it had none.
   * The remembered refusal is dropped at the same moment, or it would outlive
   * the thing it was describing.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setRefused(false);
      void onRecheck();
    });
    return () => subscription.remove();
  }, [onRecheck]);

  /** Asking is over: the system will not put the question again. */
  const settled = refused || (permission !== null && !permission.canAskAgain);

  /**
   * Asks, and refuses to hang.
   *
   * The request does not always answer. Android will not show a dialog for
   * `READ_MEDIA_VISUAL_USER_SELECTED` unless the app also asks for
   * `READ_MEDIA_IMAGES`, and a host app that declares only the first leaves the
   * promise pending forever — which looked exactly like a dead button, because
   * a promise that never resolves leaves the screen as it was. A deadline turns
   * that silence into an answer.
   */
  const ask = async () => {
    setAsking(true);
    try {
      const answer = await Promise.race([
        onRequest(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (!answer || !answer.granted) setRefused(true);
    } catch {
      setRefused(true);
    } finally {
      setAsking(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 28 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 22,
        }}
      >
        <Icon name="phone" size={32} color={colors.primary} />
      </View>

      <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.6 }}>
        {settled ? 'Imadeo cannot see your photos' : 'Let Imadeo see your photos'}
      </Text>
      <Text
        style={{ color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 12, marginBottom: 28 }}
      >
        {settled
          ? 'Nothing on this phone can be backed up until photo access is switched on. You can turn it on for Imadeo in your phone’s settings.'
          : 'Nothing is uploaded until you ask for it. Access is only used to work out which photos your server does not have yet.'}
      </Text>

      <Button
        label={settled ? 'Open Settings' : 'Allow access'}
        icon={settled ? 'settings' : 'check'}
        busy={asking}
        onPress={() => (settled ? void Linking.openSettings() : void ask())}
      />
    </View>
  );
}
