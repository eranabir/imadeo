import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { signOut, storedToken, type Session } from './src/lib/auth';
import { forget, load, type ServerInfo } from './src/lib/server';
import { BackupScreen } from './src/screens/BackupScreen';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { colors } from './src/theme';

export default function App() {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [restoring, setRestoring] = useState(true);

  // Neither the address nor the session should be retyped on every launch.
  useEffect(() => {
    (async () => {
      // Secure storage can fail — it is unavailable on web, and a locked
      // keystore can throw on device. Either way the app has to fall through to
      // the connect screen rather than sit on a spinner forever.
      try {
        const [url, token] = await Promise.all([load(), storedToken()]);
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
        <BackupScreen
          serverUrl={server.url}
          onSignOut={async () => {
            await signOut();
            setSignedIn(false);
          }}
        />
      )}
      <StatusBar style="light" />
    </>
  );
}
