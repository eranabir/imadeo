import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { signOut, storedToken, type Session } from './src/lib/auth';
import { forget, load, type ServerInfo } from './src/lib/server';
import { Tabs, type Tab } from './src/components/Tabs';
import { BackupScreen } from './src/screens/BackupScreen';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { colors } from './src/theme';

export default function App() {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState<Tab>('backup');

  // Neither the address nor the session should be retyped on every launch.
  useEffect(() => {
    (async () => {
      // Secure storage can fail — it is unavailable on web, and a locked
      // keystore can throw on device. Either way the app has to fall through to
      // the connect screen rather than sit on a spinner forever.
      try {
        // Secure storage can hang rather than fail — it did on an Android
        // emulator, leaving the app on its spinner indefinitely. A rejection
        // would have been caught below; a promise that never settles would
        // not, so restore is given a deadline of its own.
        const [url, token] = await Promise.race([
          Promise.all([load(), storedToken()]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('storage timed out')), 4000),
          ),
        ]);
        if (url) setServer({ url, version: 'unknown' });
        if (url && token) setSignedIn(true);
      } catch {
        // Nothing restored; start from the beginning.
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  // Changing server invalidates the session with it — a token from one server
  // means nothing to another.
  const changeServer = async () => {
    await Promise.all([forget(), signOut()]);
    setSignedIn(false);
    setServer(null);
  };

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
      {!server ? (
        <ConnectScreen onConnected={setServer} />
      ) : !signedIn ? (
        <SignInScreen
          serverUrl={server.url}
          onSignedIn={() => setSignedIn(true)}
          onChangeServer={changeServer}
        />
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {/* All three stay mounted. Backup keeps its progress and the library
              its scroll position when you move between them, which a plain
              swap would throw away mid-upload. */}
          <View style={{ flex: 1, display: tab === 'library' ? 'flex' : 'none' }}>
            <LibraryScreen serverUrl={server.url} />
          </View>
          <View style={{ flex: 1, display: tab === 'backup' ? 'flex' : 'none' }}>
            <BackupScreen serverUrl={server.url} />
          </View>
          <View style={{ flex: 1, display: tab === 'settings' ? 'flex' : 'none' }}>
            <SettingsScreen
              serverUrl={server.url}
              onChangeServer={changeServer}
              onSignOut={async () => {
                await signOut();
                setSignedIn(false);
              }}
            />
          </View>

          <Tabs active={tab} onChange={setTab} />
        </View>
      )}
      <StatusBar style="light" />
    </>
  );
}
