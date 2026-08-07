import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ping, useServerReachable } from '../lib/api';
import { colors, radius, shadow } from '../theme';
import { Icon } from './Icon';
import { BAR_HEIGHT, BAR_MARGIN } from './Tabs';
import { Touchable } from './ui';

/**
 * Says when the server has stopped answering.
 *
 * Sits above the tab bar rather than at the top of a screen, because it is not
 * about the screen you are on — nothing in the app works while this is up, and
 * the empty grids behind it are a symptom rather than the news. It stays until
 * a request gets through, so it also disappears on its own the moment the
 * server comes back.
 */
export function ServerBanner({ serverUrl }: { serverUrl: string }) {
  const reachable = useServerReachable();
  const insets = useSafeAreaInsets();
  const [retrying, setRetrying] = useState(false);

  if (reachable) return null;

  const host = serverUrl.replace(/^https?:\/\//, '');

  return (
    <View
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        // Clear of the tab bar, whose height it asks for rather than guesses.
        bottom: Math.max(insets.bottom, BAR_MARGIN) + BAR_HEIGHT + 8,
        zIndex: 25,
      }}
      pointerEvents="box-none"
    >
      <View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 12,
            paddingLeft: 14,
            paddingRight: 8,
            borderRadius: radius.lg,
            backgroundColor: colors.danger,
          },
          shadow(3),
        ]}
      >
        <Icon name="close" size={18} color="#fff" strong />

        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 14.5, fontWeight: '700' }}>
            Can’t reach your server
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12.5, marginTop: 1 }}>
            {host} is not answering
          </Text>
        </View>

        <Touchable
          onPress={async () => {
            setRetrying(true);
            try {
              await ping(serverUrl);
            } finally {
              setRetrying(false);
            }
          }}
          disabled={retrying}
          radius={radius.pill}
          label="Try again"
        >
          <View
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: radius.pill,
              backgroundColor: 'rgba(255,255,255,0.2)',
              minWidth: 78,
              alignItems: 'center',
            }}
          >
            {retrying ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 13.5, fontWeight: '700' }}>Try again</Text>
            )}
          </View>
        </Touchable>
      </View>
    </View>
  );
}
