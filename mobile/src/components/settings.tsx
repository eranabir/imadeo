import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';
import { Toggle, Touchable } from './ui';
import { colors, radius } from '../theme';

/*
 * The shapes a settings page is made of.
 *
 * Lifted out of `SettingsScreen` when the account moved to a page of its own:
 * two screens drawing the same card, the same row and the same red action had
 * to be drawing them from the same place, or they would drift apart the first
 * time either was touched.
 */

export function StorageRow({ used, capacity }: { used: number | null; capacity: number | null }) {
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
export function Choice({
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

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      {/* Above the card rather than inside it, the way both platforms head a
          list of settings — the heading names the group, it is not a row in
          it. */}
      {title && (
        <Text
          style={{
            color: colors.muted,
            fontSize: 12.5,
            fontWeight: '700',
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            paddingHorizontal: 16,
            paddingBottom: 8,
          }}
        >
          {title}
        </Text>
      )}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 18,
          paddingHorizontal: 14,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** A row whose value is a switch rather than a reading. */
export function SwitchRow({
  icon,
  label,
  hint,
  on,
  onChange,
  disabled,
  last = false,
}: {
  icon: IconName;
  label: string;
  hint: string;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
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

export function Row({
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

export function Action({
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
export function bytes(value: string | number) {
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
