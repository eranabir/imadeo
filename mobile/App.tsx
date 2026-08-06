import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { load, type ServerInfo } from './src/lib/server';
import { colors } from './src/theme';

export default function App() {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [restoring, setRestoring] = useState(true);

  // A saved address should not make anyone retype it on every launch.
  useEffect(() => {
    load()
      .then((url) => { if (url) setServer({ url, version: 'unknown' }); })
      .finally(() => setRestoring(false));
  }, []);

  if (restoring) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      {server ? <SignInPlaceholder url={server.url} /> : <ConnectScreen onConnected={setServer} />}
      <StatusBar style="light" />
    </>
  );
}

/** Next screen up: the existing JWT login, once the server is known. */
import { Text } from 'react-native';
function SignInPlaceholder({ url }: { url: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>Connected</Text>
      <Text style={{ color: colors.muted, marginTop: 8, textAlign: 'center' }}>{url}</Text>
    </View>
  );
}
