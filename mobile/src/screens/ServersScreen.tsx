import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Header, useHeaderClearance } from '../components/Header';
import { Icon } from '../components/Icon';
import { WifiNetworks } from '../components/WifiNetworks';
import { createProfile, listServers, probeServerAddresses, type ServerInfo, type ServerProfile } from '../lib/server';
import { colors, radius, TAB_BAR_CLEARANCE } from '../theme';

interface Props {
  active: ServerInfo;
  onBack: () => void;
  onSelect: (server: ServerProfile) => Promise<void>;
  onSave: (server: ServerProfile) => Promise<void>;
  onRemove: (server: ServerProfile) => Promise<void>;
  openWith?: 'list' | 'edit' | 'add';
}

function newDraft(): ServerProfile {
  return { id: '', name: '', externalUrl: '', internalUrl: '', ssids: [], version: 'unknown' };
}

/** Add and edit saved servers; switching is an explicit, confirmed action. */
export function ServersScreen({ active, onBack, onSelect, onSave, onRemove, openWith = 'list' }: Props) {
  const [servers, setServers] = useState<ServerProfile[]>([]);
  const [draft, setDraft] = useState<ServerProfile | null>(
    openWith === 'edit' ? active : openWith === 'add' ? newDraft() : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clearance = useHeaderClearance();

  const refresh = useCallback(async () => setServers(await listServers()), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      let version = draft.version;
      if (!draft.id) {
        const checked = await probeServerAddresses(draft);
        version = checked.version;
      }
      const profile = createProfile({ ...draft, version, id: draft.id || undefined });
      await onSave(profile);
      await refresh();
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this server.');
    } finally {
      setBusy(false);
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

  const closeDraft = () => {
    setError(null);
    if (openWith !== 'list') onBack();
    else setDraft(null);
  };

  const select = (profile: ServerProfile) => {
    Alert.alert(
      `Use ${profile.name}?`,
      'Switching servers takes you to that server’s sign-in screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use server', onPress: () => void onSelect(profile) },
      ],
    );
  };

  if (draft) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={draft.id ? 'Edit server' : 'Add server'} icon="storage" onBack={closeDraft} />
      <ScrollView contentContainerStyle={{ paddingTop: clearance + 8, paddingHorizontal: 16, paddingBottom: TAB_BAR_CLEARANCE }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21, marginBottom: 24 }}>
          Add an internal address, an external address, or both. With both, Imadeo uses the internal address on the Wi-Fi networks below.
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>NAME</Text>
        <TextInput value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="Home" placeholderTextColor={colors.faint} style={field()} />
        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8 }}>EXTERNAL URL · OPTIONAL</Text>
        <TextInput value={draft.externalUrl ?? ''} onChangeText={(externalUrl) => setDraft({ ...draft, externalUrl })} placeholder="https://photos.example.com" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={field(Boolean(error))} />
        <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8 }}>INTERNAL URL · OPTIONAL</Text>
        <TextInput value={draft.internalUrl ?? ''} onChangeText={(internalUrl) => setDraft({ ...draft, internalUrl })} placeholder="http://192.168.1.40:6666" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={field(Boolean(error))} />
        {draft.externalUrl?.trim() && draft.internalUrl?.trim() ? (
          <WifiNetworks value={draft.ssids} onChange={(ssids) => setDraft({ ...draft, ssids })} />
        ) : null}
        {error ? <Text style={{ color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: 8 }}>{error}</Text> : null}
        <Pressable onPress={save} disabled={busy || !(draft.externalUrl?.trim() || draft.internalUrl?.trim())} style={({ pressed }) => ({ marginTop: 26, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center', opacity: busy || !(draft.externalUrl?.trim() || draft.internalUrl?.trim()) ? 0.45 : pressed ? 0.85 : 1 })}>
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={{ color: colors.onPrimary, fontSize: 16, fontWeight: '700' }}>Save server</Text>}
        </Pressable>
        {draft.id ? (
          <Pressable onPress={() => Alert.alert('Remove server?', `${draft.name || 'This server'} will be removed from this phone.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void onRemove(draft).then(() => { setDraft(null); void refresh(); }) }])} style={{ paddingVertical: 18, alignItems: 'center' }}>
            <Text style={{ color: colors.danger, fontSize: 16, fontWeight: '700' }}>Remove server</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <Header title="Servers" icon="storage" onBack={onBack} />
    <ScrollView contentContainerStyle={{ paddingTop: clearance + 8, paddingHorizontal: 16, paddingBottom: TAB_BAR_CLEARANCE }}>
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 21, marginBottom: 16 }}>
        Edit or remove a saved server. Switching to another server is always a separate action.
      </Text>
      {servers.map((item) => {
        const selected = item.id === active.id;
        return (
          <View key={item.id} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: selected ? colors.primary : colors.border }}>
            <Pressable onPress={() => { setDraft(item); setError(null); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, opacity: pressed ? 0.72 : 1 })}>
              <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}><Icon name="storage" size={20} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{item.name}</Text>
                {item.externalUrl ? (
                  <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13, marginTop: 3 }}>
                    External · {item.externalUrl.replace(/^https?:\/\//, '')}
                  </Text>
                ) : null}
                {item.internalUrl ? (
                  <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13, marginTop: 3 }}>
                    Internal · {item.internalUrl.replace(/^https?:\/\//, '')}
                  </Text>
                ) : null}
              </View>
              {selected ? <Icon name="check" size={20} color={colors.primary} strong /> : null}
            </Pressable>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border }}>
              <Pressable
                onPress={() => { setDraft(item); setError(null); }}
                style={({ pressed }) => ({ flex: 1, padding: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700' }}>Edit server</Text>
              </Pressable>
              {!selected ? (
                <Pressable
                  onPress={() => select(item)}
                  style={({ pressed }) => ({ flex: 1, padding: 12, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: colors.border, opacity: pressed ? 0.7 : 1 })}
                >
                  <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700' }}>Use server</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
      <Pressable onPress={() => { setDraft(newDraft()); setError(null); }} style={({ pressed }) => ({ marginTop: 6, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center', backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 })}>
        <Text style={{ color: colors.onPrimary, fontSize: 16, fontWeight: '700' }}>Add a server</Text>
      </Pressable>
    </ScrollView>
    </View>
  );
}
