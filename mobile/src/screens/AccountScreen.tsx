import { ScrollView, Text, View } from 'react-native';
import { useHeaderClearance } from '../components/Header';
import { useHeaderSlot } from '../header';
import { Action, Group, Row, StorageRow } from '../components/settings';
import { useResource } from '../lib/api';
import { colors, TAB_BAR_CLEARANCE } from '../theme';

interface Me {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  quotaSizeInBytes?: string | number | null;
}

interface Statistics {
  images: number;
  videos: number;
  total: number;
  usageInBytes: string;
  disk?: { totalBytes: number | null; availableBytes: number | null; usedBytes: number | null };
}

/** The same two letters the bar's button shows, from the same rule. */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

/**
 * Whose library this is.
 *
 * A page rather than a row in Settings, because the two answer different
 * questions: Settings is how the app behaves, and this is who it belongs to.
 * On a self-hosted server that is not a formality — the machine can hold more
 * than one account, and until now nothing in the app said which one was
 * signed in.
 *
 * What sits here is what belongs to the person: their name and address, whether
 * they administer the server, how much of their allowance the library uses, and
 * the way out. The server itself, and every preference about how the app
 * behaves, stays in Settings.
 */
export function AccountScreen({
  serverUrl,
  onSignOut,
  onBack,
}: {
  serverUrl: string;
  onSignOut: () => void;
  onBack: () => void;
}) {
  const me = useResource<Me>(serverUrl, '/users/me');
  const { data } = useResource<Statistics>(serverUrl, '/users/me/statistics');

  const clearance = useHeaderClearance();

  useHeaderSlot('account', { title: 'Account', icon: 'person', onBack }, []);

  /*
   * The same measure Settings uses: a quota if the account has one, otherwise
   * what is used plus what is still free on the volume. The disk's total would
   * report a nearly full bar for an empty library sharing a disk with
   * everything else.
   */
  const quota = me.data?.quotaSizeInBytes ? Number(me.data.quotaSizeInBytes) : null;
  const free = data?.disk?.availableBytes ?? null;
  const capacity = quota ?? (data && free !== null ? Number(data.usageInBytes) + free : null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: clearance + 16,
          paddingBottom: TAB_BAR_CLEARANCE,
          paddingHorizontal: 16,
        }}
      >
        {/* The person, at the size of a person rather than a row. Their name is
            the heading of their own page. */}
        <View style={{ alignItems: 'center', paddingVertical: 22 }}>
          <View
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.onPrimary, fontSize: 30, fontWeight: '700' }}>
              {initialsOf(me.data?.name ?? '')}
            </Text>
          </View>

          <Text
            numberOfLines={1}
            style={{
              color: colors.text,
              fontSize: 22,
              fontWeight: '700',
              letterSpacing: -0.5,
              marginTop: 14,
            }}
          >
            {me.data?.name ?? 'Signed in'}
          </Text>
          {me.data?.email && (
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 14, marginTop: 3 }}>
              {me.data.email}
            </Text>
          )}
        </View>

        <Group>
          <Row
            icon="backup"
            label="Server"
            value={serverUrl.replace(/^https?:\/\//, '')}
            dot={data ? colors.online : me.error ? colors.danger : undefined}
          />
          {/* Said plainly rather than as a badge: it changes what the account
              can do on the server, and a coloured pill is easy to miss. */}
          <Row
            icon="person"
            label="Role"
            value={me.data ? (me.data.isAdmin ? 'Administrator' : 'Member') : '—'}
          />
        </Group>

        <Group title="Library">
          <Row icon="library" label="Photos" value={data ? data.images.toLocaleString() : '—'} />
          <Row icon="play" label="Videos" value={data ? data.videos.toLocaleString() : '—'} />
          <StorageRow used={data ? Number(data.usageInBytes) : null} capacity={capacity} />
        </Group>

        <Action label="Sign out" onPress={onSignOut} danger />
      </ScrollView>
    </View>
  );
}
