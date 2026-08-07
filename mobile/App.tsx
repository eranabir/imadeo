import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from './src/components/Loading';
import { ServerBanner } from './src/components/ServerBanner';
import { Tabs, type Tab } from './src/components/Tabs';
import { signOut, storedToken } from './src/lib/auth';
import { forget, load, type ServerInfo } from './src/lib/server';
import { NavigationProvider, PushedScreen, useNavigation, type Route } from './src/navigation';
import { restore as restoreAutoBackup } from './src/lib/autobackup';
import { SelectionProvider } from './src/selection';
import { AlbumScreen } from './src/screens/AlbumScreen';
import { BrowseScreen } from './src/screens/BrowseScreen';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { PeopleScreen } from './src/screens/PeopleScreen';
import { PersonScreen } from './src/screens/PersonScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
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
        // The background schedule can be lost to an app update or a restore,
        // while the setting that asked for it survives. Put it back to match.
        void restoreAutoBackup();
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

  return (
    <SafeAreaProvider>
      {restoring ? (
        <View style={[styles.fill, styles.centre]}>
          <Loading label="Opening Imadeo…" />
        </View>
      ) : !server ? (
        <ConnectScreen onConnected={setServer} />
      ) : !signedIn ? (
        <SignInScreen
          serverUrl={server.url}
          onSignedIn={() => setSignedIn(true)}
          onChangeServer={changeServer}
        />
      ) : (
        <NavigationProvider>
          <SelectionProvider>
            <SignedIn
              serverUrl={server.url}
              onChangeServer={changeServer}
              onSignOut={async () => {
                await signOut();
                setSignedIn(false);
              }}
            />
          </SelectionProvider>
        </NavigationProvider>
      )}
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

function SignedIn({
  serverUrl,
  onChangeServer,
  onSignOut,
}: {
  serverUrl: string;
  onChangeServer: () => void;
  onSignOut: () => void;
}) {
  const { stack, pop, popToRoot } = useNavigation();
  const [tab, setTab] = useState<Tab>('library');

  return (
    <View style={styles.fill}>
      {/* Every tab stays mounted. A backup keeps its progress and the grids
          keep their scroll position when you move between them, which a plain
          swap would throw away mid-upload. */}
      <Pane on={tab === 'library'}>
        <LibraryScreen serverUrl={serverUrl} />
      </Pane>
      <Pane on={tab === 'browse'}>
        <BrowseScreen serverUrl={serverUrl} folderId={null} />
      </Pane>
      <Pane on={tab === 'search'}>
        <SearchScreen serverUrl={serverUrl} />
      </Pane>
      <Pane on={tab === 'people'}>
        <PeopleScreen serverUrl={serverUrl} />
      </Pane>
      <Pane on={tab === 'settings'}>
        <SettingsScreen
          serverUrl={serverUrl}
          onChangeServer={onChangeServer}
          onSignOut={onSignOut}
        />
      </Pane>

      <ServerBanner serverUrl={serverUrl} />

      <Tabs
        active={tab}
        onChange={(next) => {
          // A tab press is a request to be at that tab, not four levels inside
          // whatever was open over it.
          popToRoot();
          setTab(next);
        }}
      />

      {/* Pushed screens cover the tabs entirely, including the bar: a folder
          three levels down is not one of the five destinations, and leaving the
          bar visible would suggest tapping it goes back. Earlier entries stay
          mounted underneath so going back finds the list where it was left. */}
      {stack.map((entry) => (
        <PushedScreen key={entry.key} entry={entry}>
          <Screen route={entry.route} serverUrl={serverUrl} onBack={pop} />
        </PushedScreen>
      ))}
    </View>
  );
}

function Screen({
  route,
  serverUrl,
  onBack,
}: {
  route: Route;
  serverUrl: string;
  onBack: () => void;
}) {
  switch (route.name) {
    case 'folder':
      return (
        <BrowseScreen
          serverUrl={serverUrl}
          folderId={route.id}
          title={route.title}
          onBack={onBack}
        />
      );
    case 'album':
      return (
        <AlbumScreen
          serverUrl={serverUrl}
          albumId={route.id}
          title={route.title}
          onBack={onBack}
        />
      );
    case 'person':
      return (
        <PersonScreen
          serverUrl={serverUrl}
          personId={route.id}
          title={route.title}
          onBack={onBack}
        />
      );
  }
}

/**
 * A tab that is off screen but still alive.
 *
 * `display: none` rather than unmounting, so an upload in progress on Library
 * survives a look at the albums.
 *
 * The arriving screen rises the last few pixels and fades up. Without it the
 * tab bar's indicator was the only thing that moved and the content behind it
 * simply cut, which made a considered transition look like a glitch in one
 * half of the screen.
 */
function Pane({ on, children }: { on: boolean; children: ReactNode }) {
  const enter = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    if (!on) {
      // Reset while hidden, so it has somewhere to travel from next time.
      enter.setValue(0);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [on, enter]);

  return (
    <Animated.View
      style={[
        styles.fill,
        !on && styles.hidden,
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
  hidden: { display: 'none' },
});
