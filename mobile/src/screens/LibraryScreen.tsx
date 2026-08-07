import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from 'react-native';
import { Empty } from '../components/AssetGrid';
import { Header, HeaderAction, useHeaderClearance } from '../components/Header';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { pendingCount, runBackup, uploadedIds, type Progress } from '../lib/backup';
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
function dayLabel(at: number): string {
  const taken = new Date(at);
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const days = Math.round((midnight(now) - midnight(taken)) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';

  return taken.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(taken.getFullYear() === now.getFullYear() ? null : { year: 'numeric' }),
  });
}

/**
 * The camera roll cut into days, then into rows.
 *
 * SectionList cannot lay a section out in columns, so each row of three is one
 * item. Grouping first and chunking second keeps a day's last row short rather
 * than letting the next day start halfway across it.
 */
function byDay(assets: MediaLibrary.Asset[]) {
  const days: { title: string; data: MediaLibrary.Asset[][] }[] = [];

  for (const asset of assets) {
    const title = dayLabel(asset.creationTime);
    let day = days[days.length - 1];
    if (!day || day.title !== title) {
      day = { title, data: [] };
      days.push(day);
    }
    const row = day.data[day.data.length - 1];
    if (!row || row.length === COLUMNS) day.data.push([asset]);
    else row.push(asset);
  }

  return days;
}

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
  /** Read inside the upload loop, so Stop takes effect on the next item. */
  const stop = useRef(false);

  const clearance = useHeaderClearance(0);
  const selectionBar = useSelectionBar();

  // The floating tab bar sits where the selection count does.
  const setBarActive = selectionBar.setActive;
  useEffect(() => {
    setBarActive(picked.length > 0);
    return () => setBarActive(false);
  }, [picked.length, setBarActive]);

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
      setPending(await pendingCount());
      setUploaded(await uploadedIds());
    } finally {
      setLoading(false);
    }
  }, [permission?.granted, permission?.accessPrivileges]);

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
  if (!allowed) {
    return (
      <AskForAccess
        permission={permission}
        onRequest={requestPermission}
        onRecheck={checkPermission}
      />
    );
  }

  const backedUp = pending === 0;
  const host = serverUrl.replace(/^https?:\/\//, '');

  /** Start, or stop what is already running. */
  const backUp = async () => {
    if (progress) {
      // Already running: this press is a stop.
      stop.current = true;
      return;
    }
    const only = picked.length > 0 ? picked : undefined;
    stop.current = false;
    setError(null);
    setProgress({ done: 0, total: 0, failed: 0 });
    try {
      await runBackup(serverUrl, setProgress, () => stop.current, only);
      setPending(await pendingCount());
      setUploaded(await uploadedIds());
      setPicked([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed.');
    } finally {
      setProgress(null);
    }
  };

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id],
    );

  /** Of what is picked, how much is not already on the server. */
  const pickedPending = picked.filter((id) => !uploaded.has(id)).length;

  const sections = byDay(assets);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/*
        Backing up is the one thing this screen is for, so it lives in the bar
        rather than in a card the grid scrolls away. A card meant the button
        left the screen exactly when a run was worth watching, and it cost a
        third of the first screenful before a single photo was visible.
      */}
      <Header
        title={picked.length > 0 ? `${picked.length} selected` : 'Library'}
        icon="phone"
        subtitle={
          progress
            ? `${progress.done} of ${progress.total} sent to ${host}`
            : picked.length > 0
              ? pickedPending === 0
                ? 'Already backed up · tap to change'
                : `${pickedPending.toLocaleString()} to send to ${host}`
              : total === null
                ? 'Reading this phone…'
                : backedUp
                  ? `${total.toLocaleString()} on this phone · all backed up`
                  : `${total.toLocaleString()} on this phone · ${pending === null ? 'checking' : `${pending.toLocaleString()} to back up`}`
        }
        /*
         * Nothing to send means no button. Re-reading the phone is what pulling
         * the grid down already does, so a control that only did that was
         * offering a second way to do nothing in particular.
         */
        action={
          progress ? (
            <HeaderAction label="Stop" icon="close" onPress={() => void backUp()} />
          ) : picked.length > 0 ? (
            pickedPending === 0 ? (
              <HeaderAction label="Clear" icon="close" onPress={() => setPicked([])} />
            ) : (
              <HeaderAction
                label={`Back up ${pickedPending}`}
                icon="backup"
                onPress={() => void backUp()}
              />
            )
          ) : backedUp ? undefined : (
            <HeaderAction label="Back up" icon="backup" onPress={() => void backUp()} />
          )
        }
      >
        {progress && progress.total > 0 && (
          <View style={{ height: 3, backgroundColor: colors.border }}>
            <View
              style={{
                height: '100%',
                width: `${Math.round((progress.done / progress.total) * 100)}%`,
                backgroundColor: colors.primary,
              }}
            />
          </View>
        )}
      </Header>

      <SectionList
        sections={sections}
        keyExtractor={(row) => row[0].id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingTop: clearance, paddingBottom: TAB_BAR_CLEARANCE }}
        renderSectionHeader={({ section }) => (
          <Text
            style={{
              color: colors.text,
              fontSize: 15,
              fontWeight: '700',
              letterSpacing: -0.3,
              // Flush with the tiles below, which sit at the screen edge with
              // only their 1px gutter. An inset here left the date floating
              // away from the photos it belongs to.
              paddingLeft: 2,
              paddingRight: 16,
              paddingTop: 16,
              paddingBottom: 4,
            }}
          >
            {section.title}
          </Text>
        )}
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

              {progress && progress.failed > 0 && (
                <Text style={{ color: colors.faint, fontSize: 12.5 }}>
                  {progress.failed} could not be sent. They stay queued for next time.
                </Text>
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
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
        // Otherwise the status bar stays dark-on-dark over the black backdrop.
        statusBarTranslucent
      >
        <Pressable
          onPress={() => setViewing(null)}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}
        >
          {viewing && (
            <Image
              source={viewing.uri}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
              transition={140}
            />
          )}
        </Pressable>
      </Modal>
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
