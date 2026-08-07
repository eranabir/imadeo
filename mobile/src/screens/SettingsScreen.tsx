import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Glass, liquidGlass } from '../components/Glass';
import { Header, useHeaderClearance } from '../components/Header';
import { Icon, type IconName } from '../components/Icon';
import { useResource } from '../lib/api';
import { colors, TAB_BAR_CLEARANCE } from '../theme';

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
          <Row icon="backup" label="Backup" value="While the app is open" />
          <Row
            icon="sparkle"
            label="Appearance"
            value={liquidGlass ? 'Liquid glass' : 'Dark'}
            last
          />
        </Group>

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
          {/* Written as an iOS limitation, which it is not — Imadeo does no
              background work on either platform. Naming the wrong operating
              system to an Android user is worse than saying nothing. */}
          Backup runs while Imadeo is open. A run picks up from where it
          stopped the next time you open the app.
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
