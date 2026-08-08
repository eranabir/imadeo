import { StatusBar } from 'expo-status-bar';
import { Stack, usePathname, useSegments } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Header } from '../src/components/Header';
import { HeaderSlots, useHeaderSlots } from '../src/header';
import { Loading } from '../src/components/Loading';
import { resolvedDark, useAppearance } from '../src/lib/preferences';
import { ConnectScreen } from '../src/screens/ConnectScreen';
import { SignInScreen } from '../src/screens/SignInScreen';
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
   * Keyed on the appearance so a change repaints everything.
   *
   * The palette is a module object every screen imports rather than a context
   * they subscribe to — swapping its values is invisible to React, so the tree
   * is thrown away and rebuilt instead. It happens once, on a deliberate press
   * in Settings; nothing about it needs to be cheap.
   */
  const appearance = useAppearance();

  return (
    <SafeAreaProvider key={appearance}>
      <SessionProvider>
        <SelectionProvider>
          <Gate />
        </SelectionProvider>
      </SessionProvider>
      <StatusBar style={resolvedDark() ? 'light' : 'dark'} />
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
  const { server, signedIn, restoring, connect, signedInNow, changeServer } = useSession();

  if (restoring) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Loading label="Opening Imadeo…" />
      </View>
    );
  }

  if (!server) return <ConnectScreen onConnected={connect} />;

  if (!signedIn) {
    return (
      <SignInScreen
        serverUrl={server.url}
        onSignedIn={signedInNow}
        onChangeServer={changeServer}
      />
    );
  }

  /*
   * A native stack around the tabs, with its own header switched off — for now.
   *
   * The tab bar is native from this commit; the top bar is not yet. It cannot
   * be: a native header holds a title and a couple of buttons, and ours carries
   * a segmented control on Browse and People and a search field on Search.
   * Those have to move down into the scrolling content before the platform's
   * header can take over, which is the next piece of work.
   *
   * Until then the shell keeps drawing the one persistent bar it already had,
   * above the stack, and the stack supplies the push animation, the back
   * gesture and the routing.
   */
  return (
    <HeaderSlots>
      <View style={styles.fill}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
        <Bar />
      </View>
    </HeaderSlots>
  );
}

/**
 * The one bar, over whatever the stack is showing.
 *
 * Reads the slot belonging to the route in front: a pushed screen publishes
 * under its own key and owns the bar while it is up, and the tab underneath
 * takes it back when that screen goes.
 */
function Bar() {
  const slots = useHeaderSlots();
  const segments = useSegments();
  const pathname = usePathname();

  // A pushed route is anything that is not one of the five tabs.
  const pushed = !segments.includes('(tabs)');
  const key = pushed
    ? Object.keys(slots).find((id) => id.includes(pathname.split('/').pop() ?? ''))
    : TAB_SLOTS[pathname] ?? 'library';

  const bar = key ? slots[key] : undefined;
  if (!bar) return null;

  return <Header {...bar}>{bar.below}</Header>;
}

/** Which slot each tab publishes under, by its route. */
const TAB_SLOTS: Record<string, string> = {
  '/': 'library',
  '/browse': 'browse',
  '/search': 'search',
  '/people': 'people',
  '/settings': 'settings',
};

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
