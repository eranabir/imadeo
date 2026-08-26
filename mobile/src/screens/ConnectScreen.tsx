import { useEffect, useState } from 'react';
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
import { LogoLockup } from '../components/Logo';
import { requestCurrentSsid } from '../lib/network';
import { createProfile, probe, type ServerProfile } from '../lib/server';
import { colors, radius } from '../theme';

interface Props {
  onConnected: (server: ServerProfile) => Promise<void>;
}

type Step = 'discover' | 'address' | 'details';

/** The first-run flow: a lightweight local discovery view with a clear manual path. */
export function ConnectScreen({ onConnected }: Props) {
  const [step, setStep] = useState<Step>('discover');
  const [searching, setSearching] = useState(true);
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [internalUrl, setInternalUrl] = useState('');
  const [ssids, setSsids] = useState<string[]>([]);
  const [version, setVersion] = useState('unknown');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearching(false), 1200);
    return () => clearTimeout(timer);
  }, []);

  const discoverOrContinue = () => setStep('address');

  const checkAddress = async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await probe(address);
      setAddress(result.externalUrl);
      setInternalUrl(result.externalUrl);
      setVersion(result.version);
      setStep('details');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect.');
    } finally {
      setChecking(false);
    }
  };

  const addCurrentWifi = async () => {
    setError(null);
    const ssid = await requestCurrentSsid();
    if (!ssid) {
      setError('Imadeo could not read this Wi-Fi name. Allow location access, then try again.');
      return;
    }
    setSsids((current) => current.includes(ssid) ? current : [...current, ssid]);
  };

  const save = async () => {
    setChecking(true);
    setError(null);
    try {
      await onConnected(createProfile({
        name,
        externalUrl: address,
        internalUrl,
        ssids,
        version,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this server.');
    } finally {
      setChecking(false);
    }
  };

  const field = (invalid = false) => ({
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: invalid ? colors.danger : colors.border,
    borderRadius: radius.md,
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
        <View style={{ marginBottom: 28 }}><LogoLockup /></View>

        {step === 'discover' ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 29, fontWeight: '700', textAlign: 'center' }}>
              Searching on your home network
            </Text>
            <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 12 }}>
              Looking for an Imadeo server nearby.
            </Text>
            <View style={{ height: 96, justifyContent: 'center' }}>
              {searching ? <ActivityIndicator size="large" color={colors.primary} /> : null}
            </View>
            {!searching ? (
              <Text style={{ color: colors.faint, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
                No server announced itself on this network.
              </Text>
            ) : null}
            <Pressable onPress={discoverOrContinue} style={{ marginTop: 42 }}>
              <Text style={{ color: colors.primary, fontSize: 17, fontWeight: '700' }}>
                Enter address manually
              </Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'address' ? (
          <>
            <Text style={{ color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6 }}>
              Add your server
            </Text>
            <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: 10, marginBottom: 30 }}>
              Enter the address Imadeo uses when you are away from home.
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>
              EXTERNAL URL
            </Text>
            <TextInput
              value={address}
              onChangeText={(value) => { setAddress(value); if (error) setError(null); }}
              placeholder="https://photos.example.com"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={checkAddress}
              editable={!checking}
              style={field(Boolean(error))}
            />
            {error ? <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: 12 }}>{error}</Text> : null}
            <Pressable
              onPress={checkAddress}
              disabled={checking || !address.trim()}
              style={({ pressed }) => ({
                marginTop: 26,
                backgroundColor: colors.primary,
                borderRadius: radius.pill,
                paddingVertical: 15,
                alignItems: 'center',
                opacity: checking || !address.trim() ? 0.45 : pressed ? 0.85 : 1,
              })}
            >
              {checking ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={{ color: colors.onPrimary, fontSize: 16, fontWeight: '700' }}>Continue</Text>}
            </Pressable>
          </>
        ) : null}

        {step === 'details' ? (
          <>
            <Text style={{ color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6 }}>
              Finish setup
            </Text>
            <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: 10, marginBottom: 24 }}>
              Add a faster home-network address if you use one. It will only be used on the Wi-Fi names below.
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>NAME</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Home" placeholderTextColor={colors.faint} style={field()} />
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8 }}>INTERNAL URL</Text>
            <TextInput value={internalUrl} onChangeText={setInternalUrl} placeholder="http://192.168.1.40:3001" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={field()} />
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8 }}>WI-FI NETWORKS</Text>
            {ssids.map((ssid) => (
              <Pressable key={ssid} onPress={() => setSsids((current) => current.filter((item) => item !== ssid))} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
                <Text style={{ color: colors.text, fontSize: 16, flex: 1 }}>{ssid}</Text>
                <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '700' }}>Remove</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => void addCurrentWifi()} style={{ paddingVertical: 12 }}>
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>Use current Wi-Fi</Text>
            </Pressable>
            {error ? <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: 8 }}>{error}</Text> : null}
            <Pressable onPress={save} disabled={checking} style={({ pressed }) => ({ marginTop: 26, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center', opacity: checking ? 0.45 : pressed ? 0.85 : 1 })}>
              {checking ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={{ color: colors.onPrimary, fontSize: 16, fontWeight: '700' }}>Connect</Text>}
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
