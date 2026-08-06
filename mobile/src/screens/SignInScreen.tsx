import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { login, type Session } from '../lib/auth';
import { Logo } from '../components/Logo';
import { colors } from '../theme';

interface Props {
  serverUrl: string;
  onSignedIn: (session: Session) => void;
  onChangeServer: () => void;
}

export function SignInScreen({ serverUrl, onSignedIn, onChangeServer }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await login(serverUrl, email, password));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };

  const field = (invalid: boolean) => ({
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: invalid ? colors.danger : colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ marginBottom: 28 }}><Logo /></View>

        <Text style={{ color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6 }}>
          Welcome back
        </Text>

        {/* Which server this is matters here in a way it never does in a hosted
            app — someone may have several, and the address is the only thing
            that tells them apart. */}
        <Pressable onPress={onChangeServer} hitSlop={8} style={{ marginTop: 8, marginBottom: 30 }}>
          <Text style={{ color: colors.muted, fontSize: 15 }}>
            {serverUrl.replace(/^https?:\/\//, '')}
            <Text style={{ color: colors.accent }}>  Change</Text>
          </Text>
        </Pressable>

        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600', marginBottom: 8 }}>EMAIL</Text>
        <TextInput
          value={email}
          onChangeText={(t) => { setEmail(t); if (error) setError(null); }}
          placeholder="you@example.com"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          editable={!busy}
          style={field(Boolean(error))}
        />

        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 8 }}>
          PASSWORD
        </Text>
        <TextInput
          value={password}
          onChangeText={(t) => { setPassword(t); if (error) setError(null); }}
          placeholder="••••••••"
          placeholderTextColor={colors.faint}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          returnKeyType="go"
          onSubmitEditing={submit}
          editable={!busy}
          style={field(Boolean(error))}
        />

        {error ? (
          <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: 14 }}>{error}</Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={busy || !email.trim() || !password}
          style={({ pressed }) => ({
            marginTop: 26,
            backgroundColor: colors.accent,
            borderRadius: 999,
            paddingVertical: 15,
            alignItems: 'center',
            opacity: busy || !email.trim() || !password ? 0.45 : pressed ? 0.85 : 1,
          })}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Sign in</Text>
          )}
        </Pressable>

        <Text style={{ color: colors.faint, fontSize: 13, textAlign: 'center', marginTop: 22 }}>
          Your photos stay on your own server.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
