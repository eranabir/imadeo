import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
} from 'expo-router';
import { StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Opening } from '../src/components/Loading';
import { resolvedDark, useAppearance } from '../src/lib/preferences';
import { ConnectScreen } from '../src/screens/ConnectScreen';
import { ConnectionErrorScreen } from '../src/screens/ConnectionErrorScreen';
import { SignInScreen } from '../src/screens/SignInScreen';
import {
  beginServerCheck,
  markServerReachable,
  ping,
  request,
  useServerReachability,
} from '../src/lib/api';
import { findReachable } from '../src/lib/server';
import { SelectionProvider } from '../src/selection';
import { SessionProvider, useSession } from '../src/session';
import { colors } from '../src/theme';

/**
 * Everything above routing.
 *
 * The session has to be provided outside the gate, because the gate is what
 * reads it. `Slot` is where the routed tree goes once there is a server and a
 * signed-in user to render it for.
 */
export default function RootLayout() {
  /*
   * Subscribed to the appearance, not keyed on it.
   *
   * The palette is a module object every screen imports rather than a context
   * they subscribe to, and `applyPalette` swaps its values in place. Every
   * screen reads `colors.x` while it renders and nothing here is memoised, so
   * one state change at the root is enough to repaint all of them — which is
   * what Expo's own guidance for themed native UI says to do.
   *
   * This used to key the tree on the value instead, throwing it away and
   * rebuilding it. A rebuilt `NativeTabs` came back without the background it
   * was given, so the bar went clear and its labels ended up on top of a
   * photograph; it also reset which tab was showing, so changing the setting
   * threw you out of Settings.
   */
  const appearance = useAppearance();
  const systemAppearance = useColorScheme();
  const dark = appearance === 'system' ? systemAppearance !== 'light' : appearance === 'dark';
  const baseTheme = dark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: colors.primary,
      background: colors.bg,
      card: colors.chrome,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };

  return (
    <SafeAreaProvider>
      <ThemeProvider value={navigationTheme}>
        <SessionProvider>
          <SelectionProvider>
            <Gate />
          </SelectionProvider>
        </SessionProvider>
        <StatusBar style={resolvedDark() ? 'light' : 'dark'} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * No server means no app, and no session means no library.
 *
 * Deliberately not a redirect to a `/connect` route: these are not places you
 * navigate to, they are the two states the app can be in before it has
 * anything to show, and giving them URLs would let you leave them by going
 * back.
 */
function Gate() {
  const {
    server,
    signedIn,
    restoring,
    connect,
    signedInNow,
    changeServer,
    activateServerAddress,
  } = useSession();
  const reachability = useServerReachability();
  const [verifiedServer, setVerifiedServer] = useState<string | null>(null);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const justSignedIn = useRef(false);

  // Check the selected server before mounting any route. Signed-in sessions
  // use an authenticated endpoint so an expired JWT is resolved here, at the
  // shell, instead of independently by whichever tab happens to load first.
  useEffect(() => {
    if (!server) {
      setVerifiedServer(null);
      return;
    }

    // The successful login request already proved this exact address and the
    // new token. Do not follow it with a root probe plus /users/me before the
    // first screen can mount.
    if (signedIn && justSignedIn.current && verifiedServer === server.url) {
      justSignedIn.current = false;
      return;
    }

    let active = true;
    // An alternate address is another route to the workspace we have already
    // authenticated, not a different workspace. Keep the mounted native tabs
    // while that route is checked; tearing the entire navigator down here made
    // a harmless address update flash the opening screen and reset the tab.
    if (!signedIn) setVerifiedServer(null);
    setVerificationFailed(false);

    // A saved server without a token can show its sign-in form immediately.
    // Connect and Login are themselves the authoritative network checks.
    if (!signedIn) {
      markServerReachable();
      return;
    }

    beginServerCheck();

    const check = async () => {
      // The authenticated request proves the session and the common address in
      // one round trip. Only scan alternate routes when that address fails.
      try {
        await request(server.url, '/users/me');
        if (active) {
          setVerificationFailed(false);
          setVerifiedServer(server.url);
        }
        return;
      } catch {
        if (!active) return;
      }

      const address = await findReachable(server);
      if (!active) return;
      if (address !== server.url) {
        if (address) await activateServerAddress(address);
        else {
          await ping(server.url);
          if (active) setVerificationFailed(true);
        }
        return;
      }
      setVerificationFailed(true);
    };

    void check();
    return () => {
      active = false;
    };
  }, [server, signedIn]);

  const retryConnection = async () => {
    if (!server) return;
    setRetrying(true);
    setVerificationFailed(false);
    const address = await findReachable(server);
    if (!address) {
      await ping(server.url);
      if (signedIn) setVerificationFailed(true);
      setRetrying(false);
      return;
    }
    if (address !== server.url) {
      await activateServerAddress(address);
      setRetrying(false);
      return;
    }
    if (signedIn) {
      try {
        await request(server.url, '/users/me');
        setVerifiedServer(server.url);
      } catch {
        // `request` owns the unreachable and expired-session transitions. This
        // catches other server failures so the shell cannot spin indefinitely.
        setVerificationFailed(true);
      }
    } else {
      markServerReachable();
    }
    setRetrying(false);
  };

  if (restoring) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Opening />
      </View>
    );
  }

  if (!server) return <ConnectScreen onConnected={connect} />;

  if (reachability === 'checking' && !verifiedServer) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Opening />
      </View>
    );
  }

  if (reachability === 'unreachable' || (signedIn && verificationFailed)) {
    return (
      <ConnectionErrorScreen
        serverUrl={server.url}
        retrying={retrying}
        onRetry={() => void retryConnection()}
        onChangeServer={() => void changeServer()}
      />
    );
  }

  if (!signedIn) {
    return (
      <SignInScreen
        serverUrl={server.url}
        onSignedIn={() => {
          justSignedIn.current = true;
          setVerificationFailed(false);
          setVerifiedServer(server.url);
          signedInNow();
        }}
        onChangeServer={changeServer}
      />
    );
  }

  if (!verifiedServer) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Opening />
      </View>
    );
  }

  /*
   * The stack owns routing and gestures; each route owns its own top chrome.
   * Keeping stateful chrome providers out of this level is important: native
   * tabs eagerly mount their routes, and publication updates here can disturb
   * UIKit's tab-controller appearance during startup.
   */
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
