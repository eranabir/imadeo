import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Glass, liquidGlass } from '../components/Glass';
import { Header, useHeaderClearance } from '../components/Header';
import { Icon, type IconName } from '../components/Icon';
import { Toggle } from '../components/ui';
import { useResource } from '../lib/api';
import { isAvailable, isEnabled, lastRun, setEnabled, type LastRun } from '../lib/autobackup';
import { colors, TAB_BAR_CLEARANCE } from '../theme';

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
}

export function SettingsScreen({ serverUrl, onSignOut, onChangeServer }: Props) {
  const { data } = useResource<Statistics>(serverUrl, '/assets/statistics');
  const auto = useAutoBackup();
  const clearance = useHeaderClearance();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Settings" icon="settings" />

      <ScrollView
        contentContainerStyle={{
          paddingTop: clearance + 16,
          paddingBottom: TAB_BAR_CLEARANCE,
          paddingHorizontal: 16,
        }}
      >
        <Group>
          <Row icon="backup" label="Server" value={serverUrl.replace(/^https?:\/\//, '')} />
          <Row icon="library" label="Photos" value={data ? data.images.toLocaleString() : '—'} />
          <Row icon="play" label="Videos" value={data ? data.videos.toLocaleString() : '—'} />
          <Row
            icon="photo"
            label="Storage used"
            value={data ? bytes(data.usageInBytes) : '—'}
            last
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
          <Row
            icon="sparkle"
            label="Appearance"
            value={liquidGlass ? 'Liquid glass' : 'Dark'}
            last
          />
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
}: {
  icon: IconName;
  label: string;
  value: string;
  last?: boolean;
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
