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
import { discoverServers, type DiscoveredServer } from '../lib/discovery';
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
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredServer[]>([]);
  const [externalUrl, setExternalUrl] = useState('');
  const [name, setName] = useState('');
  const [internalUrl, setInternalUrl] = useState('');
  const [ssids, setSsids] = useState<string[]>([]);
  const [version, setVersion] = useState('unknown');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSearching(true);
    setDiscoveryError(null);
    const stop = discoverServers(
      (server) => {
        setSearching(false);
        setDiscovered((current) =>
          current.some((item) => item.url === server.url) ? current : [...current, server],
        );
      },
      (message) => {
        setSearching(false);
        setDiscoveryError(message);
      },
    );
    const timer = setTimeout(() => setSearching(false), 8000);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [discoveryAttempt]);

  const discoverOrContinue = () => setStep('address');

  const searchAgain = () => {
    setDiscovered([]);
    setDiscoveryAttempt((current) => current + 1);
  };

  const chooseDiscovered = (server: DiscoveredServer) => {
    setInternalUrl(server.url);
    setName(server.name);
    setStep('address');
  };

  const checkAddress = async () => {
    setChecking(true);
    setError(null);
    try {
      const candidate = internalUrl.trim() || externalUrl.trim();
      if (!candidate) throw new Error('Enter an internal or external server address.');
      const result = await probe(candidate);
      if (candidate === internalUrl.trim()) setInternalUrl(result.url);
      else setExternalUrl(result.url);
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
        externalUrl,
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
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 'discover' ? (
          <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}>
            <View style={{ alignItems: 'center', marginBottom: 34 }}>
              <LogoLockup size={54} />
            </View>
            <Text style={{ color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6, textAlign: 'center' }}>
              Connect to your server
            </Text>
            <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 12 }}>
              Imadeo can find a server connected to the same local network.
            </Text>

            <View
              style={{
                marginTop: 28,
                padding: 20,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.lg,
                backgroundColor: colors.surface,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.raised,
                  }}
                >
                  {searching ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text style={{ color: discovered.length ? colors.online : colors.muted, fontSize: 20, fontWeight: '700' }}>
                      {discovered.length ? '✓' : '—'}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>
                    {searching
                      ? 'Searching your local network…'
                      : discovered.length
                        ? `${discovered.length} server${discovered.length === 1 ? '' : 's'} found`
                        : 'No server found'}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 3 }}>
                    {searching
                      ? 'This can take a few seconds.'
                      : discovered.length
                        ? 'Choose a server below to continue.'
                        : 'Make sure the server is running and this phone is on the same network.'}
                  </Text>
                </View>
              </View>

              {discoveryError ? (
                <Text style={{ color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: 14 }}>
                  Local discovery is unavailable. You can still enter the address manually.
                </Text>
              ) : null}

              {discovered.map((server) => (
                <Pressable
                  key={server.url}
                  onPress={() => chooseDiscovered(server)}
                  style={({ pressed }) => ({
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: 14,
                    marginTop: 14,
                    backgroundColor: pressed ? colors.pressed : colors.raised,
                  })}
                >
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{server.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 3 }}>{server.url}</Text>
                </Pressable>
              ))}

              {!searching && !discovered.length ? (
                <Pressable onPress={searchAgain} style={{ alignSelf: 'flex-start', paddingTop: 16, paddingBottom: 2 }}>
                  <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '700' }}>Search again</Text>
                </Pressable>
              ) : null}
            </View>

            <Pressable
              onPress={discoverOrContinue}
              style={({ pressed }) => ({
                marginTop: 16,
                borderRadius: radius.pill,
                paddingVertical: 15,
                alignItems: 'center',
                backgroundColor: pressed ? colors.pressed : colors.raised,
                borderWidth: 1,
                borderColor: colors.border,
              })}
            >
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>
                Enter server address
              </Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'address' ? (
          <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}>
            <View style={{ marginBottom: 28 }}><LogoLockup /></View>
            <Text style={{ color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6 }}>
              Add your server
            </Text>
            <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: 10, marginBottom: 30 }}>
              Add an internal address, an external address, or both.
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>
              EXTERNAL URL · OPTIONAL
            </Text>
            <TextInput
              value={externalUrl}
              onChangeText={(value) => { setExternalUrl(value); if (error) setError(null); }}
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
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8 }}>
              INTERNAL URL · OPTIONAL
            </Text>
            <TextInput
              value={internalUrl}
              onChangeText={(value) => { setInternalUrl(value); if (error) setError(null); }}
              placeholder="http://192.168.1.40:6666"
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
              disabled={checking || !(externalUrl.trim() || internalUrl.trim())}
              style={({ pressed }) => ({
                marginTop: 26,
                backgroundColor: colors.primary,
                borderRadius: radius.pill,
                paddingVertical: 15,
                alignItems: 'center',
                opacity: checking || !(externalUrl.trim() || internalUrl.trim()) ? 0.45 : pressed ? 0.85 : 1,
              })}
            >
              {checking ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={{ color: colors.onPrimary, fontSize: 16, fontWeight: '700' }}>Continue</Text>}
            </Pressable>
          </View>
        ) : null}

        {step === 'details' ? (
          <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center' }}>
            <View style={{ marginBottom: 28 }}><LogoLockup /></View>
            <Text style={{ color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6 }}>
              Finish setup
            </Text>
            <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: 10, marginBottom: 24 }}>
              Name this server and choose the Wi-Fi networks that should use its internal address.
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>NAME</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Home" placeholderTextColor={colors.faint} style={field()} />
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
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
