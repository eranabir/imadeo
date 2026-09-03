import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
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
import * as FileSystem from 'expo-file-system/legacy';
import {
  ActivityIndicator,
  AppState,
  Easing,
  FlatList,
  Dimensions,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  Animated,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollViewMarker } from 'react-native-screens/experimental';
import { DayHeader, Empty } from '../components/AssetGrid';
import { VideoPage } from '../components/AssetViewer';
import { useGrowFrom, type Rect } from '../components/grow';
import { DateLabel, Scrubber, useDayAtTop, useScrolledAway } from '../components/Scrubber';
import { Account } from '../components/Account';
import { BackupProgressScreen } from './BackupProgressScreen';
import { Header, HeaderAction, useHeaderClearance, type HeaderConfig } from '../components/Header';
import { intoDays } from '../lib/day';
import { Icon, type IconName } from '../components/Icon';
import { DeviceActions } from '../components/PhotoActions';
import { SelectionDock } from '../components/SelectionDock';
import { ConfirmSheet } from '../components/sheets';
import { Button, Sheet, Touchable } from '../components/ui';
import { isEnabled, onForegroundBackupRequested } from '../lib/autobackup';
import {
  backupInFlight,
  cancelBackup,
  pendingCount,
  runBackup,
  uploadedIds,
  type Progress,
} from '../lib/backup';
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
  /** The device photo open full screen, and the tile it came up out of.
      Declared with the other state rather than beside the list, which is below
      the permission gate's early return. */
  const [viewing, setViewing] = useState<{
    asset: MediaLibrary.Asset;
    from: Rect | null;
  } | null>(null);
  /** The per-item backup list, opened from the progress bar. */
  const [showProgress, setShowProgress] = useState(false);
  /** Set while the "remove from this phone" confirmation is up. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Whether a run is in flight. `progress` outlives it, as the last account. */
  const [running, setRunning] = useState(false);
  /** A cancellation has reached the native uploader but has not settled yet. */
  const [stopping, setStopping] = useState(false);
  /** Read inside the upload loop, so Stop takes effect on the next item. */
  const stop = useRef(false);

  // The progress strip adds 16pt to the floating header. Add the same amount
  // to the list clearance so the normal gap below the bar does not disappear.
  const clearance = useHeaderClearance(
    running && progress !== null && progress.total > 0 ? 16 : 0,
  );
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

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

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

  /**
   * Start, or stop what is already running.
   *
   * `ids` is the one photo the viewer asked for; without it the selection is
   * what goes, and without a selection everything outstanding does.
   */
  const backUp = async (ids?: string[]) => {
    if (running) {
      // Already running: stop both the queue and the native stream carrying a
      // potentially multi-gigabyte video. The queue flag alone was only read
      // after that stream finished, which left the screen saying Stop while
      // apparently doing nothing.
      stop.current = true;
      setStopping(true);
      await cancelBackup();
      return;
    }
    const only = ids ?? (picked.length > 0 ? picked : undefined);
    stop.current = false;
    setError(null);
    setRunning(true);
    setProgress({ done: 0, total: 0, failed: 0, held: 0, queue: [], at: -1, sent: [], failures: [] });
    try {
      const result = await runBackup(serverUrl, setProgress, () => stop.current, only);
      if (stop.current) {
        // Stopping should not be followed by two fresh library/server scans.
        // Account only for files that finished before cancellation; the next
        // normal refresh performs the full reconciliation.
        setUploaded((current) => new Set([...current, ...result.sent]));
        setPending((current) =>
          current === null ? null : Math.max(0, current - result.sent.length),
        );
      } else {
        setPending(await pendingCount(serverUrl));
        setUploaded(await uploadedIds(serverUrl));
      }
      // A selection is what was sent, so it has been dealt with. One photo sent
      // from the viewer leaves whatever was picked exactly where it was.
      if (!ids) setPicked([]);
    } catch (e) {
      // Cancellation can happen before the queue exists (while checking the
      // server or asking Photos for an iCloud original). It is still a clean
      // stop, not an error to show above the library.
      if (!stop.current) setError(e instanceof Error ? e.message : 'Backup failed.');
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
      setStopping(false);
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
  const loadRef = useRef(load);
  loadRef.current = load;

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

    /*
     * Read the camera roll again before doing anything with it.
     *
     * The grid is read once when this screen mounts, and photos are taken while
     * the app is away — that is the whole reason the run below exists. Without
     * this the newest photo was uploaded and then missing from the one screen
     * that is supposed to be showing what is on the phone: on the server, not
     * in the library. Unconditional, because a stale grid is wrong whether or
     * not automatic backup is switched on.
     */
    void catchUp();
    const stopListening = onForegroundBackupRequested(() => {
      void loadRef.current().then(catchUp);
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void loadRef.current().then(catchUp);
    });

    return () => {
      alive = false;
      stopListening();
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
  const removeFromPhone = async (ids?: string[]) => {
    setError(null);
    try {
      const removed = await MediaLibrary.deleteAssetsAsync(ids ?? picked);
      // Declining the system prompt is an answer, not a failure.
      if (!removed) return;
      if (!ids) setPicked([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove those from this phone.');
    }
  };

  /** Of what is picked, how much is not already on the server. */
  const pickedPending = picked.filter((id) => !uploaded.has(id)).length;

  const sections = byDay(assets);

  const bar: HeaderConfig = {
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
      <HeaderAction
        label={stopping ? 'Stopping…' : 'Stop'}
        icon="close"
        onPress={() => void backUp()}
      />
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
  };
  /* The rail and the label, exactly as the server-side grid drives them. */
  const scrollY = useRef(new Animated.Value(0)).current;
  const list = useRef<SectionList<MediaLibrary.Asset[]>>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [away, markAway] = useScrolledAway();

  /* Only the tail below the grid is set from this; the date is not. */
  const [rowHeight, setRowHeight] = useState(0);

  const [day, markDay, Cell] = useDayAtTop(sections, clearance);

  const seek = useCallback((offset: number) => {
    list.current?.getScrollResponder()?.scrollTo({ y: offset, animated: false });
  }, []);

  /*
   * The gate stands here, below every hook.
   *
   * It used to come first, which meant later hooks ran only once access had
   * been granted — hooks called on some renders and not others, which React
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

  const toggleDay = (ids: string[]) => {
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
    <View collapsable={false} style={{ flex: 1, backgroundColor: colors.bg }}>
      {/*
        Backing up is the one thing this screen is for, so it lives in the bar
        rather than in a card the grid scrolls away. A card meant the button
        left the screen exactly when a run was worth watching, and it cost a
        third of the first screenful before a single photo was visible.
      */}
      <ScrollViewMarker style={{ flex: 1 }}>
        <SectionList
        sections={sections}
        keyExtractor={(row, index) => row[0]?.id ?? `row-${index}`}
        stickySectionHeadersEnabled={false}
        ref={list}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
          listener: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
            markAway(event.nativeEvent.contentOffset.y);
            markDay(event.nativeEvent.contentOffset.y);
          },
        })}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={(_, height) => setContentHeight(height)}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        // Every cell reports where it sits, which is what the date is read from.
        CellRendererComponent={Cell}
        // Room under the last row for it to be scrolled up to, so the label can
        // name the final day the way it names every other one — a screen less
        // the bar and one row, which lands the last row exactly at the bar.
        contentContainerStyle={{
          paddingTop: clearance,
          paddingBottom: Math.max(TAB_BAR_CLEARANCE, viewportHeight - clearance - rowHeight),
        }}
        // Nothing above a day until a selection gives it a reason; the label
        // under the bar answers "when am I" the rest of the time.
        renderSectionHeader={({ section }) =>
          picked.length > 0 ? (
            <DayHeader
              title={section.title}
              ids={idsOf([...section.data])}
              selected={picked}
              onToggleDay={toggleDay}
            />
          ) : null
        }
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
          <View
            style={{ flexDirection: 'row' }}
            onLayout={(event) => {
              const height = event.nativeEvent.layout.height;
              if (Math.abs(height - rowHeight) > 0.5) setRowHeight(height);
            }}
          >
            {row.map((item) => (
              <Tile
                key={item.id}
                asset={item}
                on={picked.includes(item.id)}
                sent={uploaded.has(item.id)}
                selecting={picked.length > 0}
                onToggle={toggle}
                onOpen={(asset, from) => setViewing({ asset, from })}
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
      </ScrollViewMarker>

      <Header {...bar} account={<Account />}>
        {bar.below}
      </Header>
      <SelectionDock />

      {/* The day at the top of the screen, in place of a heading above every
          one of them. Hidden while selecting, when the headings come back. */}
      {picked.length === 0 && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: clearance + 6, left: 0, right: 0 }}
        >
          <DateLabel visible={away}>{day}</DateLabel>
        </View>
      )}

      <Scrubber
        scrollY={scrollY}
        contentHeight={contentHeight}
        viewportHeight={viewportHeight}
        topInset={clearance}
        label={seeking ? day : undefined}
        visible={away || seeking}
        onSeek={seek}
        onDrag={setSeeking}
      />

      {/*
        The device photo, full screen.

        Its own viewer rather than the one in AssetGrid: that one addresses the
        server by asset id and token, and these files have neither — they are
        local `ph://` references the Photos framework resolves.
      */}
      {viewing && (
        <DeviceViewer
          assets={assets}
          start={assets.findIndex((asset) => asset.id === viewing.asset.id)}
          from={viewing.from}
          host={host}
          uploaded={uploaded}
          busy={running}
          onClose={() => setViewing(null)}
          onBackUp={(asset) => void backUp([asset.id])}
          onRemove={(asset) => {
            // Nothing left to look at on this page once it is gone.
            setViewing(null);
            void removeFromPhone([asset.id]);
          }}
        />
      )}

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
 *
 * It owns its own `Modal` so that the hardware back button and the close button
 * are the same door — one that shuts with the animation rather than through it.
 */
function DeviceViewer({
  assets,
  start,
  from,
  host,
  uploaded,
  busy,
  onClose,
  onBackUp,
  onRemove,
}: {
  assets: MediaLibrary.Asset[];
  start: number;
  /** The tile this was opened from, when it could be measured in time. */
  from: Rect | null;
  host: string;
  /** Which of these the server already holds. */
  uploaded: Set<string>;
  busy: boolean;
  onClose: () => void;
  onBackUp: (asset: MediaLibrary.Asset) => void;
  onRemove: (asset: MediaLibrary.Asset) => void;
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
  const opened = Math.max(0, start);
  const [at, setAt] = useState(opened);
  /** The bar over the photograph, which a tap puts out of the way. */
  const [chrome, setChrome] = useState(true);
  const [details, setDetails] = useState(false);
  const [removing, setRemoving] = useState(false);

  const asset = assets[at] ?? assets[opened];

  /*
   * Back into the tile only while that tile is still the photograph on screen.
   * After a swipe the one it was opened from is somewhere else entirely, and
   * shrinking into the wrong square is worse than not shrinking at all.
   */
  const [leaving, setLeaving] = useState(false);
  const { mounted, enter, grown } = useGrowFrom(at === opened ? from : null, !leaving);

  const bar = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(bar, {
      toValue: chrome ? 1 : 0,
      duration: chrome ? 150 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [chrome, bar]);

  /*
   * Shrinking back is a state change rather than a call: `useGrowFrom` runs the
   * animation and says when there is nothing left on screen, and only then is
   * the viewer taken down.
   */
  const leave = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    if (leaving && !mounted) onClose();
  }, [leaving, mounted, onClose]);

  const backedUp = uploaded.has(asset.id);
  const taken = asset.creationTime ? new Date(asset.creationTime) : null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={leave} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        {/* The dark comes up under the photograph rather than with it, so the
            grid is still there to be left behind. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.viewer, opacity: enter }]}
        />

        <Animated.View style={[StyleSheet.absoluteFill, grown]}>
          <FlatList
            data={assets}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            initialScrollIndex={opened}
            // Every page is exactly the screen's width, so the list never has to
            // measure anything to know where a given photo starts.
            getItemLayout={(_data, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={(event) =>
              setAt(Math.round(event.nativeEvent.contentOffset.x / width))
            }
            windowSize={3}
            renderItem={({ item, index }) => (
              <Pressable
                // A tap puts the bar away rather than closing, which is what the
                // server-side viewer does and what leaves the photograph alone.
                onPress={() => setChrome((on) => !on)}
                accessibilityRole="image"
                accessibilityLabel={item.filename}
                style={{ width, height, justifyContent: 'center' }}
              >
                {item.mediaType === 'video' ? (
                  <DeviceVideoPage
                    asset={item}
                    active={index === at}
                    controlsVisible={chrome && index === at}
                    width={width}
                    height={height}
                  />
                ) : (
                  <Image
                    source={item.uri}
                    style={{ width, height }}
                    contentFit="contain"
                    recyclingKey={item.id}
                    transition={140}
                  />
                )}
              </Pressable>
            )}
          />
        </Animated.View>

        {/*
          Everything along the top, and nothing along the bottom.

          The bottom edge of a photo viewer belongs to whatever is being played,
          and to the home gesture besides. This bar owns the photograph: what it
          is on the left, what can be done with it on the right.
        */}
        <Animated.View
          pointerEvents={chrome ? 'box-none' : 'none'}
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
            gap: 6,
            backgroundColor: colors.overlay,
            opacity: Animated.multiply(bar, enter),
          }}
        >
          <Touchable onPress={leave} radius={radius.pill} label="Close" style={{ width: 38, height: 38 }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={22} color="#fff" />
            </View>
          </Touchable>

          <View style={{ flex: 1, marginLeft: 4 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
              {asset.filename}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 1 }}>
              {[
                `${at + 1} of ${assets.length}`,
                taken ? taken.toLocaleDateString() : null,
                asset.mediaType === 'video' ? runningTime(asset.duration) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>

          <ViewerAction icon="info" label="Details" tint="#fff" onPress={() => setDetails(true)} />

          {/*
            Backed up or not is the one thing this tab exists to answer, so the
            state and the action are the same control: a tick once the server
            has it, and the way to send it until then.
          */}
          <ViewerAction
            icon={backedUp ? 'cloud-done' : 'backup'}
            label={backedUp ? `Already on ${host}` : 'Back up now'}
            // White like everything else over a photograph. The accent picked
            // out one control on a bar where nothing else is coloured, which
            // read as a button to press rather than the state it is.
            tint="#fff"
            disabled={backedUp || busy}
            onPress={() => onBackUp(asset)}
          />

          <ViewerAction
            icon="trash"
            label="Remove from this phone"
            tint="#fff"
            disabled={busy}
            onPress={() => setRemoving(true)}
          />
        </Animated.View>

        <Sheet open={details} title={asset.filename} onClose={() => setDetails(false)}>
          <PhotoFacts asset={asset} backedUp={backedUp} host={host} />
        </Sheet>

        {/* The same words the grid's own confirmation uses, because it is the
            same deletion — one photo rather than a selection. */}
        <ConfirmSheet
          open={removing}
          title="Remove this from this phone?"
          description={
            backedUp
              ? `It stays on ${host}. Only the copy in this phone's gallery is removed, and you can still see it in Browse.`
              : 'This has not been backed up yet, so this copy would be gone for good.'
          }
          confirmLabel="Remove from phone"
          onClose={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            onRemove(asset);
          }}
        />
      </View>
    </Modal>
  );
}

/**
 * Resolve a Photos-library video to a file the native player can open.
 *
 * iOS gives the grid a `ph://` database reference. That is enough for
 * `expo-image` to ask Photos for a thumbnail, but it is not a video URL. Asking
 * MediaLibrary for the asset info turns it into a `file://` URL and downloads
 * an iCloud-offloaded original when playback actually reaches this page.
 */
function DeviceVideoPage({
  asset,
  active,
  controlsVisible,
  width,
  height,
}: {
  asset: MediaLibrary.Asset;
  active: boolean;
  controlsVisible: boolean;
  width: number;
  height: number;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || uri) return;

    let alive = true;
    setFailed(false);

    void MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: true })
      .then((info) => {
        if (!alive) return;
        const playable = info.localUri ?? (asset.uri.startsWith('ph://') ? null : asset.uri);
        if (!playable) throw new Error('No playable file is available');
        setUri(playable);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });

    return () => {
      alive = false;
    };
  }, [active, asset, attempt, uri]);

  if (uri) {
    return (
      <VideoPage
        uri={uri}
        token={null}
        active={active}
        controlsVisible={controlsVisible}
        width={width}
        height={height}
        rotation={0}
      />
    );
  }

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      {failed ? (
        <>
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
            This video could not be opened.
          </Text>
          <Touchable
            onPress={() => setAttempt((value) => value + 1)}
            radius={radius.pill}
            label="Try video again"
            style={{ paddingHorizontal: 18, paddingVertical: 10, backgroundColor: colors.surface }}
          >
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>Try again</Text>
          </Touchable>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.muted, fontSize: 14 }}>Preparing video…</Text>
        </>
      )}
    </View>
  );
}

/** A length in the way a phone writes one: 1:07, not 67 seconds. */
function runningTime(seconds: number) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A size in the way a phone writes one. */
function fileSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${unit > 0 && size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

/**
 * What a photograph is, for the times the picture is not the question.
 *
 * "Is this one safe yet" first, because that is what this tab is for and the
 * rest is the sort of thing you only look up once you have started wondering
 * whether to clear some space.
 */
function PhotoFacts({
  asset,
  backedUp,
  host,
}: {
  asset: MediaLibrary.Asset;
  backedUp: boolean;
  host: string;
}) {
  const [size, setSize] = useState<number | null>(null);

  /*
   * The size is looked up rather than carried on the asset, and only once the
   * sheet is open. `shouldDownloadFromNetwork` is deliberately left off: on a
   * phone using Optimise Storage that would pull the original back from iCloud
   * to put a number on a line, so an offloaded photo says nothing instead.
   */
  useEffect(() => {
    let alive = true;
    setSize(null);

    void (async () => {
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset);
        const uri = info.localUri;
        if (!uri || uri.startsWith('ph://')) return;
        const file = await FileSystem.getInfoAsync(uri);
        if (alive && file.exists && !file.isDirectory) setSize(file.size);
      } catch {
        // A size is a nicety; the rest of the sheet is not waiting on it.
      }
    })();

    return () => {
      alive = false;
    };
  }, [asset]);

  const taken = asset.creationTime ? new Date(asset.creationTime) : null;

  return (
    <View style={{ paddingHorizontal: 4, paddingBottom: 6 }}>
      <Fact
        label="Backup"
        value={backedUp ? `On ${host}` : 'Not backed up yet'}
        tint={backedUp ? colors.primary : undefined}
      />
      {taken && (
        <Fact
          label="Taken"
          value={taken.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
        />
      )}
      <Fact
        label={asset.mediaType === 'video' ? 'Video' : 'Photo'}
        value={[
          `${asset.width} × ${asset.height}`,
          asset.mediaType === 'video' ? runningTime(asset.duration) : null,
          size === null ? null : fileSize(size),
        ]
          .filter(Boolean)
          .join(' · ')}
      />
    </View>
  );
}

/** One line of the details sheet: what it is on the left, what it says on the right. */
function Fact({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingVertical: 10 }}>
      <Text style={{ color: colors.faint, fontSize: 13.5, width: 78 }}>{label}</Text>
      <Text style={{ color: tint ?? colors.text, fontSize: 14.5, fontWeight: '600', flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

/** One round control in the viewer's bar, sized to sit beside a title. */
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
    <Touchable
      onPress={onPress}
      disabled={disabled}
      radius={radius.pill}
      label={label}
      style={{ width: 40, height: 40 }}
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={21} color={tint} />
      </View>
    </Touchable>
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
  onOpen: (asset: MediaLibrary.Asset, from: Rect | null) => void;
}) {
  /*
   * Where this tile is on the screen, handed over with the photograph.
   *
   * The viewer grows out of it, and the only moment its place is knowable is
   * the tap itself — the grid scrolls, and a position measured at layout would
   * be describing where the tile used to be. `measureInWindow` answers on the
   * next frame; if it cannot, the photograph opens without growing rather than
   * not at all.
   */
  const box = useRef<View>(null);

  const open = () => {
    if (!box.current) return onOpen(item, null);
    box.current.measureInWindow((x, y, width, height) =>
      onOpen(item, width > 0 ? { x, y, width, height } : null),
    );
  };

  return (
          <Pressable
            ref={box}
            // Long-press opens selection, exactly as it does in the server grid;
            // once anything is picked a plain tap adds to it rather than needing
            // the gesture again.
            onPress={() => (selecting ? onToggle(item.id) : open())}
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
