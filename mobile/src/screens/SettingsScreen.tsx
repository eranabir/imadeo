import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Glass } from '../components/Glass';
import { useHeaderClearance } from '../components/Header';
import { useHeaderSlot } from '../header';
import { Icon, type IconName } from '../components/Icon';
import { Toggle, Touchable } from '../components/ui';
import { useResource } from '../lib/api';
import {
  setAppearance,
  setAutoplayVideos,
  useAppearance,
  useAutoplayVideos,
} from '../lib/preferences';
import { isAvailable, isEnabled, lastRun, setEnabled, type LastRun } from '../lib/autobackup';
import { colors, radius, TAB_BAR_CLEARANCE } from '../theme';

/** What the last background run did, in a line. */
function summary(run: LastRun | null): string {
  if (!run) return 'On — waiting for the first run.';
  const when = new Date(run.at).toLocaleString();
  if (run.sent === 0 && run.failed === 0) return `On — nothing new at ${when}.`;
  return `On — sent ${run.sent} at ${when}${run.failed > 0 ? `, ${run.failed} failed` : ''}.`;
}

/**
 * The background-backup setting, and whether the phone will honour it.
 *
 * Availability is asked for separately because it is not the same question as
 * whether it is switched on: someone can turn it on and have the system refuse
 * anyway, and a row that only said "On" would be lying to them.
 */
function useAutoBackup() {
  const [on, setOn] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [last, setLast] = useState<LastRun | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [enabled, allowed, run] = await Promise.all([isEnabled(), isAvailable(), lastRun()]);
    setOn(enabled);
    setAvailable(allowed);
    setLast(run);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (next: boolean) => {
      setBusy(true);
      // Moved before the await so the switch answers the finger rather than the
      // system; `refresh` puts it back if the registration is refused.
      setOn(next);
      try {
        await setEnabled(next);
      } finally {
        await refresh();
        setBusy(false);
      }
    },
    [refresh],
  );

  return { on, available, last, busy, toggle };
}

interface Props {
  serverUrl: string;
  onSignOut: () => void;
  onChangeServer: () => void;
}

interface Statistics {
  images: number;
  videos: number;
  total: number;
  /**
   * A string, not a number. The column is a bigint, and the server serialises
   * those through `BigInt.prototype.toJSON` — reading it as a number here
   * silently gives NaN on any library past a few gigabytes.
   */
  usageInBytes: string;
  /**
   * Real numbers for the volume the library sits on.
   *
   * From `/users/me/statistics` rather than `/assets/statistics`, which counts
   * assets but knows nothing about the disk — the same endpoint the web
   * client's storage card reads, so the two agree.
   */
  disk?: {
    totalBytes: number | null;
    availableBytes: number | null;
    usedBytes: number | null;
  };
}

interface Me {
  /** A cap set for this account, if any. Null means the disk is the limit. */
  quotaSizeInBytes?: string | number | null;
}

export function SettingsScreen({ serverUrl, onSignOut, onChangeServer }: Props) {
  const { data } = useResource<Statistics>(serverUrl, '/users/me/statistics');
  const me = useResource<Me>(serverUrl, '/users/me');
  const auto = useAutoBackup();
  const autoplay = useAutoplayVideos();
  const appearance = useAppearance();

  /**
   * Room this library has, not the size of the disk.
   *
   * A quota if the account has one, otherwise what is used plus what is still
   * free on the volume. Measuring against the disk's total would report a
   * nearly full bar for an empty library sharing a disk with everything else,
   * which is the mistake the web client's card documents.
   */
  const quota = me.data?.quotaSizeInBytes ? Number(me.data.quotaSizeInBytes) : null;
  const free = data?.disk?.availableBytes ?? null;
  const capacity =
    quota ?? (data && free !== null ? Number(data.usageInBytes) + free : null);
  const clearance = useHeaderClearance();

  // Like every other tab: the bar is the shell's, so it stays put while this
  // page slides in and out from under it.
  useHeaderSlot('settings', { title: 'Settings', icon: 'settings' }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>

      <ScrollView
        contentContainerStyle={{
          paddingTop: clearance + 16,
          paddingBottom: TAB_BAR_CLEARANCE,
          paddingHorizontal: 16,
        }}
      >
        <Group>
          <Row
            icon="backup"
            label="Server"
            value={serverUrl.replace(/^https?:\/\//, '')}
            // A green dot only when the server has actually answered — the
            // statistics request is the proof, so nothing else has to be asked.
            dot={data ? colors.online : me.error ? colors.danger : undefined}
          />
          <Row icon="library" label="Photos" value={data ? data.images.toLocaleString() : '—'} />
          <Row icon="play" label="Videos" value={data ? data.videos.toLocaleString() : '—'} />
          <StorageRow
            used={data ? Number(data.usageInBytes) : null}
            capacity={capacity}
          />
        </Group>

        <Group>
          <SwitchRow
            icon="backup"
            label="Back up in the background"
            hint={
              auto.available === false
                ? 'Your phone has background activity switched off for Imadeo.'
                : auto.on
                  ? summary(auto.last)
                  : 'Off — photos go only while Imadeo is open.'
            }
            on={auto.on}
            disabled={auto.available === false || auto.busy}
            onChange={auto.toggle}
          />
          <SwitchRow
            icon="play"
            label="Play videos automatically"
            hint={
              autoplay
                ? 'A video starts as soon as you open it.'
                : 'Videos wait for you to press play.'
            }
            on={autoplay}
            onChange={(next) => void setAutoplayVideos(next)}
          />

          {/* Three plain words. What the app is made of — glass, blur, whatever
              the platform gives it — is not the user's business; whether it is
              light or dark is. */}
          <View style={{ paddingVertical: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name="sparkle" size={19} color={colors.primary} />
              <Text style={{ flex: 1, color: colors.text, fontSize: 15.5, fontWeight: '600' }}>
                Appearance
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['system', 'dark', 'light'] as const).map((mode) => (
                <Choice
                  key={mode}
                  label={mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light'}
                  active={appearance === mode}
                  onPress={() => void setAppearance(mode)}
                />
              ))}
            </View>
          </View>
        </Group>

        {auto.on && (
          <Text style={{ color: colors.faint, fontSize: 12.5, lineHeight: 19, marginTop: -6, marginBottom: 16 }}>
            {/* Said plainly, because the alternative is someone deciding the
                feature is broken when it is working exactly as the platform
                allows. Neither iOS nor Android will wake an app the moment a
                photo is taken. */}
            Your phone decides when to run this — usually while charging on
            Wi-Fi, and at most every 15 minutes. Opening Imadeo always sends
            anything outstanding straight away.
          </Text>
        )}

        <Action label="Connect to a different server" onPress={onChangeServer} />
        <Action label="Sign out" onPress={onSignOut} danger />

        <Text
          style={{
            color: colors.faint,
            fontSize: 12.5,
            lineHeight: 19,
            textAlign: 'center',
            marginTop: 26,
          }}
        >
          A run always picks up from where it stopped, whether it was you
          opening the app or your phone deciding it was a good moment.
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * How much room is left, as a figure and a bar.
 *
 * A number on its own says nothing — five gigabytes is either nothing or
 * everything depending on what it is out of.
 */
function StorageRow({ used, capacity }: { used: number | null; capacity: number | null }) {
  const percent =
    used !== null && capacity !== null && capacity > 0
      ? Math.min(100, (used / capacity) * 100)
      : null;

  return (
    <View style={{ paddingVertical: 14, gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name="storage" size={19} color={colors.primary} />
        <Text style={{ flex: 1, color: colors.text, fontSize: 15.5, fontWeight: '600' }}>
          Storage used
        </Text>
        <Text style={{ color: colors.muted, fontSize: 14.5, fontWeight: '600' }}>
          {used === null ? '—' : percent === null ? bytes(used) : `${Math.round(percent)}%`}
        </Text>
      </View>

      <View
        style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}
      >
        <View
          style={{
            height: '100%',
            // A hair of bar even at nothing used, so the control reads as a
            // gauge rather than as an empty box.
            width: `${percent === null ? 4 : Math.max(percent, 1.5)}%`,
            borderRadius: 3,
            backgroundColor: colors.primary,
          }}
        />
      </View>

      <Text style={{ color: colors.faint, fontSize: 12.5 }}>
        {used === null
          ? 'Reading your server…'
          : capacity === null
            ? `${bytes(used)} used`
            : `${bytes(used)} of ${bytes(capacity)} used · ${bytes(capacity - used)} free`}
      </Text>
    </View>
  );
}

/** One of a small set of mutually exclusive answers. */
function Choice({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Touchable onPress={onPress} radius={radius.pill} label={label} style={{ flex: 1 }}>
      <View
        style={{
          alignItems: 'center',
          paddingVertical: 9,
          borderRadius: radius.pill,
          backgroundColor: active ? colors.primary : colors.bg,
          borderWidth: 1,
          borderColor: active ? colors.primary : colors.border,
        }}
      >
        <Text
          style={{
            color: active ? colors.onPrimary : colors.muted,
            fontSize: 14,
            fontWeight: '700',
          }}
        >
          {label}
        </Text>
      </View>
    </Touchable>
  );
}

function Group({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 18,
        paddingHorizontal: 14,
        marginBottom: 16,
      }}
    >
      {children}
    </View>
  );
}

/** A row whose value is a switch rather than a reading. */
function SwitchRow({
  icon,
  label,
  hint,
  on,
  onChange,
  disabled,
}: {
  icon: IconName;
  label: string;
  hint: string;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Icon name={icon} size={18} color={colors.faint} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: colors.faint, fontSize: 12.5, lineHeight: 18, marginTop: 2 }}>
          {hint}
        </Text>
      </View>
      <Toggle on={on} onChange={onChange} label={label} disabled={disabled} />
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  last = false,
  dot,
}: {
  icon: IconName;
  label: string;
  value: string;
  last?: boolean;
  /** A status pip beside the value, when there is a status worth showing. */
  dot?: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      <Icon name={icon} size={18} color={colors.faint} />
      <Text style={{ color: colors.muted, fontSize: 15, flex: 1 }}>{label}</Text>
      {dot && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />}
      <Text
        numberOfLines={1}
        style={{ color: colors.text, fontSize: 15, fontWeight: '600', maxWidth: '55%' }}
      >
        {value}
      </Text>
    </View>
  );
}

function Action({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const body = (
    <Text
      style={{
        color: danger ? colors.danger : colors.text,
        fontSize: 15.5,
        fontWeight: '600',
        textAlign: 'center',
        paddingVertical: 14,
      }}
    >
      {label}
    </Text>
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ marginBottom: 10, opacity: pressed ? 0.6 : 1 })}
    >
      {danger ? (
        body
      ) : (
        <Glass radius={999} style={{ borderWidth: 1, borderColor: colors.border }}>
          {body}
        </Glass>
      )}
    </Pressable>
  );
}

/** Storage totals come back in bytes; nobody reads eleven digits. */
function bytes(value: string | number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Number(value);
  if (!Number.isFinite(size)) return '—';
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}
