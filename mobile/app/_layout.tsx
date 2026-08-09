import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack, usePathname, useSegments } from 'expo-router';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Account } from '../src/components/Account';
import { Header } from '../src/components/Header';
import { HeaderSlots, useHeaderSlots } from '../src/header';
import { Opening } from '../src/components/Loading';
import { resolvedDark, useAppearance } from '../src/lib/preferences';
import { ConnectScreen } from '../src/screens/ConnectScreen';
import { SignInScreen } from '../src/screens/SignInScreen';
import { SelectionProvider, useSelectionBar } from '../src/selection';
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
  useAppearance();

  return (
    <SafeAreaProvider>
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
        <Opening />
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
        <Dock />
      </View>
    </HeaderSlots>
  );
}

/**
 * The selection toolbar, over everything including the tab bar.
 *
 * Drawn here rather than by the screen that owns the selection, because the tab
 * bar is a sibling of that screen and composited above it — a panel rendered
 * down there comes out underneath the tabs however it is stacked. Up here it is
 * outside the tabs altogether.
 *
 * It slides in from the bottom edge as the tab bar slides out, so the two read
 * as one bar being exchanged for another rather than a panel appearing on top
 * of a gap. `shown` lags the published node so there is still something on
 * screen to animate away once the selection has gone.
 */
function Dock() {
  const { dock } = useSelectionBar();
  const [shown, setShown] = useState<ReactNode>(dock);
  const enter = useRef(new Animated.Value(dock ? 1 : 0)).current;

  useEffect(() => {
    if (dock) setShown(dock);

    const animation = Animated.timing(enter, {
      toValue: dock ? 1 : 0,
      // Out faster than in: the toolbar leaving is the end of something the tap
      // already confirmed, and waiting on it just delays the tabs coming back.
      duration: dock ? 260 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    animation.start(({ finished }) => {
      if (finished && !dock) setShown(null);
    });

    return () => animation.stop();
  }, [dock, enter]);

  if (!shown) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [DOCK_TRAVEL, 0] }) },
          ],
        },
      ]}
    >
      {shown}
    </Animated.View>
  );
}

/**
 * How far the toolbar starts below the bottom edge.
 *
 * Deliberately more than the bar is tall. It only has to be off screen at the
 * start, and the bar's height depends on the safe area, which differs by phone.
 */
const DOCK_TRAVEL = 160;

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

  /*
   * Not on a pushed screen, and not on Settings.
   *
   * A pushed screen's bar is about the thing it pushed to and carries a back
   * chevron already; and the button leads to Settings, so putting it on Settings
   * is a control that does nothing.
   */
  const account = !pushed && pathname !== '/settings' ? <Account /> : undefined;

  return (
    <Header {...bar} account={account}>
      {bar.below}
    </Header>
  );
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
