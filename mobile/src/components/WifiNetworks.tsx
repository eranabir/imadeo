import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { requestCurrentSsid, type SsidLookupIssue } from '../lib/network';
import { colors, radius } from '../theme';
import { Icon } from './Icon';

interface Props {
  value: string[];
  onChange: (networks: string[]) => void;
  autoSelectCurrent?: boolean;
}

function issueMessage(issue: SsidLookupIssue | undefined): string {
  if (issue === 'permission-denied') return 'Allow location access to read the current Wi-Fi name.';
  if (issue === 'precise-location-required') return 'Turn on Precise Location for Imadeo to read the current Wi-Fi name.';
  if (issue === 'location-disabled') return 'Turn on Location Services to read the current Wi-Fi name.';
  return 'Imadeo could not read the current Wi-Fi name. Make sure Wi-Fi is connected or enter its name below.';
}

/** Current and manually entered SSIDs used to select a server's LAN address. */
export function WifiNetworks({ value, onChange, autoSelectCurrent = true }: Props) {
  const [networkName, setNetworkName] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [currentSsid, setCurrentSsid] = useState<string | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  valueRef.current = value;
  onChangeRef.current = onChange;

  const add = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    onChange(value.includes(clean) ? value : [...value, clean]);
    setNetworkName('');
    setError(null);
  };

  const useCurrent = async (alive: () => boolean = () => true) => {
    setReading(true);
    setError(null);
    setShowSettings(false);
    const result = await requestCurrentSsid();
    if (!alive()) return;
    setReading(false);
    if (!result.ssid) {
      setError(issueMessage(result.issue));
      setShowSettings(Boolean(result.canOpenSettings));
      return;
    }
    setCurrentSsid(result.ssid);
    const current = valueRef.current;
    if (!current.includes(result.ssid)) onChangeRef.current([...current, result.ssid]);
  };

  useEffect(() => {
    if (!autoSelectCurrent) return;
    let mounted = true;
    void useCurrent(() => mounted);
    return () => { mounted = false; };
    // This runs once when an internal address becomes relevant; prop refs keep
    // the selected list current without repeating the permission prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectCurrent]);

  const openSettings = async () => {
    await Linking.openSettings();
  };

  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 4 }}>
        WI-FI NETWORKS · OPTIONAL
      </Text>
      <Text style={{ color: colors.faint, fontSize: 13, lineHeight: 18, marginBottom: 6 }}>
        Use the internal address on these networks. You can add any network name manually.
      </Text>
      {value.map((ssid) => (
        <Pressable
          key={ssid}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${ssid}`}
          onPress={() => onChange(value.filter((item) => item !== ssid))}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {ssid === currentSsid ? <Icon name="check" size={17} color={colors.online} strong /> : null}
            <Text style={{ color: colors.text, fontSize: 16 }}>{ssid}</Text>
            {ssid === currentSsid ? <Text style={{ color: colors.muted, fontSize: 13 }}>Current</Text> : null}
          </View>
          <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '700' }}>Remove</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use current Wi-Fi"
        disabled={reading}
        onPress={() => void useCurrent()}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          paddingVertical: 14,
          opacity: reading ? 0.55 : pressed ? 0.72 : 1,
        })}
      >
        {reading ? <ActivityIndicator color={colors.primary} size="small" /> : <Icon name="plus" size={18} color={colors.primary} strong />}
        <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '700' }}>
          {currentSsid ? 'Refresh current Wi-Fi' : 'Use current Wi-Fi'}
        </Text>
      </Pressable>
      {error ? (
        <View style={{ marginBottom: 10 }}>
          <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20 }}>{error}</Text>
          {showSettings ? (
            <Pressable accessibilityRole="button" onPress={() => void openSettings()} style={{ alignSelf: 'flex-start', paddingVertical: 8 }}>
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700' }}>Open Settings</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TextInput
          accessibilityLabel="Wi-Fi network name"
          value={networkName}
          onChangeText={(next) => { setNetworkName(next); if (error) setError(null); }}
          onSubmitEditing={() => add(networkName)}
          placeholder="Enter another Wi-Fi name"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          style={{
            flex: 1,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            paddingHorizontal: 16,
            paddingVertical: 14,
            color: colors.text,
            fontSize: 16,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add Wi-Fi network"
          disabled={!networkName.trim()}
          onPress={() => add(networkName)}
          style={({ pressed }) => ({
            minWidth: 66,
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 15,
            borderRadius: radius.md,
            backgroundColor: colors.raised,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: !networkName.trim() ? 0.45 : pressed ? 0.72 : 1,
          })}
        >
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}
