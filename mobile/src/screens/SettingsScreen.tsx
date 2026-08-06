import { Pressable, Text, View } from 'react-native';
import { colors } from '../theme';

interface Props {
  serverUrl: string;
  onSignOut: () => void;
  onChangeServer: () => void;
}

export function SettingsScreen({ serverUrl, onSignOut, onChangeServer }: Props) {
  const row = (label: string, value: string) => (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 15 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{value}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 64 }}>
      <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5, marginBottom: 18 }}>
        Settings
      </Text>

      {row('Server', serverUrl.replace(/^https?:\/\//, ''))}
      {row('Backup', 'While the app is open')}

      <Pressable
        onPress={onChangeServer}
        style={({ pressed }) => ({
          marginTop: 26,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 999,
          paddingVertical: 14,
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: colors.text, fontSize: 15.5, fontWeight: '600' }}>
          Connect to a different server
        </Text>
      </Pressable>

      {/* Signing out had no home once it left the Backup screen. It belongs
          here, where someone goes looking for it. */}
      <Pressable
        onPress={onSignOut}
        style={({ pressed }) => ({
          marginTop: 12,
          paddingVertical: 14,
          alignItems: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: colors.danger, fontSize: 15.5, fontWeight: '600' }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
