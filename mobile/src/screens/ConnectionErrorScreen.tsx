import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import type { ServerInfo } from '../lib/server';
import { colors, radius } from '../theme';

interface Props {
  server: ServerInfo;
  retrying: boolean;
  onRetry: () => void;
  onEditServer: () => void;
  onAddServer: () => void;
}

/**
 * The only mounted app state while the saved server cannot be reached.
 * Authenticated routes stay unmounted so cached private data can never remain
 * visible underneath this page.
 */
export function ConnectionErrorScreen({
  server,
  retrying,
  onRetry,
  onEditServer,
  onAddServer,
}: Props) {
  const address = server.url.replace(/^https?:\/\//, '');

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

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          marginTop: 26,
          padding: 16,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <View
          style={{
            width: 42,
            height: 42,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.sm,
            backgroundColor: colors.raised,
          }}
        >
          <Icon name="storage" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{server.name}</Text>
          <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 14, marginTop: 3 }}>
            {address}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={onRetry}
        disabled={retrying}
        style={({ pressed }) => ({
          marginTop: 20,
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
        onPress={onEditServer}
        disabled={retrying}
        style={({ pressed }) => ({
          alignItems: 'center',
          marginTop: 12,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.pill,
          paddingVertical: 14,
          opacity: retrying ? 0.55 : pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>Edit server settings</Text>
      </Pressable>

      <Pressable
        onPress={onAddServer}
        disabled={retrying}
        style={({ pressed }) => ({
          alignItems: 'center',
          marginTop: 8,
          paddingVertical: 12,
          opacity: retrying ? 0.55 : pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>Add new server</Text>
      </Pressable>
    </View>
  );
}
