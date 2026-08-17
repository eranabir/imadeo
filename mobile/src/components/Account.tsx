import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useResource } from '../lib/api';
import { useServerUrl } from '../session';
import { colors, radius } from '../theme';
import { Touchable } from './ui';

interface Me {
  name?: string;
  email?: string;
}

/**
 * Up to two letters, from the first two words of a name.
 *
 * The same rule the web client's top bar uses, so one person's mark is the same
 * on both. A library with no name yet falls back to the question mark rather
 * than an empty circle, which reads as a control that failed to load.
 */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

/**
 * Who is signed in, in the corner of the bar.
 *
 * The app had nothing anywhere saying whose library this was — which matters on
 * a self-hosted server, where the answer is not obvious and more than one person
 * can have an account on the same machine. The web client answers it with
 * initials in the top right, and this is the same button in the same corner.
 *
 * It leads to a page of its own rather than into Settings. The two answer
 * different questions — Settings is how the app behaves, this is whose library
 * it is — and sending someone looking for their account into a list of
 * switches is answering neither.
 *
 * Fetched here rather than threaded through every screen, so the button remains
 * a self-contained part of each route's header.
 */
export function Account() {
  const router = useRouter();
  const serverUrl = useServerUrl();
  const { data } = useResource<Me>(serverUrl, '/users/me');

  return (
    <Touchable
      onPress={() => router.push('/account')}
      radius={radius.pill}
      label={data?.name ? `Account — ${data.name}` : 'Account'}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.onPrimary, fontSize: 13, fontWeight: '700' }}>
          {initialsOf(data?.name ?? '')}
        </Text>
      </View>
    </Touchable>
  );
}
