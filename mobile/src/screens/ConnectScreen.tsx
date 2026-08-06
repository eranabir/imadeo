import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { probe, save, type ServerInfo } from '../lib/server';
import { LogoLockup } from '../components/Logo';
import { colors } from '../theme';

interface Props {
  onConnected: (server: ServerInfo) => void;
}

/**
 * The first thing anyone sees.
 *
 * Unlike a hosted product, there is no address to default to — the server is
 * wherever the person put it, so nothing else can happen until this succeeds.
 */
export function ConnectScreen({ onConnected }: Props) {
  const [address, setAddress] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setChecking(true);
    setError(null);
    try {
      const server = await probe(address);
      await save(server.url);
      onConnected(server);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 28 }}
      keyboardShouldPersistTaps="handled"
      /* The keyboard shifts the scroll offset rather than the layout. Wrapping
         this in a KeyboardAvoidingView shrank the container instead, and with
         the content centred everything above the field re-centred a frame
         before the field itself moved — the logo appeared to jump ahead of it. */
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      keyboardDismissMode="interactive"
    >
        <View style={{ marginBottom: 28 }}><LogoLockup /></View>

        <Text style={{ color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6 }}>
          Connect to your server
        </Text>
        <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: 10, marginBottom: 30 }}>
          Imadeo runs on hardware you own, so there is no address to guess. Enter
          where yours is reachable.
        </Text>

        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>
          SERVER ADDRESS
        </Text>
        <TextInput
          value={address}
          onChangeText={(t) => {
            setAddress(t);
            if (error) setError(null);
          }}
          placeholder="192.168.1.40:3001"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={connect}
          editable={!checking}
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 14,
            color: colors.text,
            fontSize: 16,
          }}
        />

        {error ? (
          <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: 12 }}>{error}</Text>
        ) : (
          <Text style={{ color: colors.faint, fontSize: 13, lineHeight: 19, marginTop: 12 }}>
            A local address like 192.168.1.40:3001, or a domain such as
            photos.example.com.
          </Text>
        )}

        <Pressable
          onPress={connect}
          disabled={checking || address.trim().length === 0}
          style={({ pressed }) => ({
            marginTop: 26,
            backgroundColor: colors.accent,
            borderRadius: 999,
            paddingVertical: 15,
            alignItems: 'center',
            opacity: checking || address.trim().length === 0 ? 0.45 : pressed ? 0.85 : 1,
          })}
        >
          {checking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Connect</Text>
          )}
        </Pressable>
    </ScrollView>
  );
}
