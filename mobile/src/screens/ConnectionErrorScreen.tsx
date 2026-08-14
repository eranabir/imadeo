import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Logo } from '../components/Logo';
import { colors } from '../theme';

interface Props {
  serverUrl: string;
  retrying: boolean;
  onRetry: () => void;
  onChangeServer: () => void;
}

/**
 * The only mounted app state while the saved server cannot be reached.
 * Authenticated routes stay unmounted so cached private data can never remain
 * visible underneath this page.
 */
export function ConnectionErrorScreen({
  serverUrl,
  retrying,
  onRetry,
  onChangeServer,
}: Props) {
  const address = serverUrl.replace(/^https?:\/\//, '');

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        padding: 28,
        backgroundColor: colors.bg,
      }}
    >
      <View style={{ alignItems: 'center', marginBottom: 30 }}>
        <Logo size={60} />
      </View>

      <Text style={{ color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 }}>
        Can’t reach your server
      </Text>
      <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: 10 }}>
        Imadeo can’t connect to {address}. Check that your server is running and that this phone
        can reach it.
      </Text>

      <Pressable
        onPress={onRetry}
        disabled={retrying}
        style={({ pressed }) => ({
          marginTop: 30,
          alignItems: 'center',
          borderRadius: 999,
          backgroundColor: colors.primary,
          paddingVertical: 15,
          opacity: retrying ? 0.55 : pressed ? 0.85 : 1,
        })}
      >
        {retrying ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={{ color: colors.onPrimary, fontSize: 16, fontWeight: '700' }}>
            Retry connection
          </Text>
        )}
      </Pressable>

      <Pressable
        onPress={onChangeServer}
        disabled={retrying}
        style={({ pressed }) => ({
          alignItems: 'center',
          marginTop: 18,
          paddingVertical: 10,
          opacity: retrying ? 0.55 : pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>Change server</Text>
      </Pressable>
    </View>
  );
}
