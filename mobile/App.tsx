import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from './src/components/Loading';
import { ServerBanner } from './src/components/ServerBanner';
import { TABS, Tabs, type Tab } from './src/components/Tabs';
import { signOut, storedToken } from './src/lib/auth';
import { forget, load, type ServerInfo } from './src/lib/server';
import { NavigationProvider, PushedScreen, useNavigation, type Route } from './src/navigation';
import { Header } from './src/components/Header';
import { HeaderSlots, useHeaderSlots, type HeaderConfig } from './src/header';
import { restore as restoreAutoBackup } from './src/lib/autobackup';
import { SelectionProvider } from './src/selection';
import { AlbumScreen } from './src/screens/AlbumScreen';
import { BrowseScreen } from './src/screens/BrowseScreen';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { PeopleScreen } from './src/screens/PeopleScreen';
import { PersonScreen } from './src/screens/PersonScreen';
import { PlaceScreen } from './src/screens/PlaceScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { resolvedDark, restorePreferences, useAppearance } from './src/lib/preferences';
import { colors } from './src/theme';

export default function App() {
  /*
   * Keyed on the appearance so a change repaints everything.
   *
   * The palette is a module object every screen imports rather than a context
   * they subscribe to — swapping its values is invisible to React, so the tree
   * is thrown away and rebuilt instead. It happens once, on a deliberate press
   * in Settings; nothing about it needs to be cheap.
   */
  const appearance = useAppearance();
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
        // The palette and the video setting, both stored the same way.
        void restorePreferences();
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
    <SafeAreaProvider key={appearance}>
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
            <HeaderSlots>
            <SignedIn
              serverUrl={server.url}
              onChangeServer={changeServer}
              onSignOut={async () => {
                await signOut();
                setSignedIn(false);
              }}
            />
            </HeaderSlots>
          </SelectionProvider>
        </NavigationProvider>
      )}
      <StatusBar style={resolvedDark() ? 'light' : 'dark'} />
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
  const slots = useHeaderSlots();

  /**
   * Whose bar the shell is showing.
   *
   * A pushed screen used to bring its own, which slid in over the top of the
   * one already there — two bars crossing, which is the thing a single bar was
   * built to stop. So the stack publishes into the same place: the topmost
   * screen that is not on its way out owns the bar, and when it goes the tab
   * underneath owns it again.
   */
  const top = stack.filter((entry) => !entry.leaving).at(-1);
  const bar = top ? slots[`push:${top.key}`] : slots[tab];

  /**
   * Changes the tab, and lets the bar rearrange itself rather than cut.
   *
   * The bar is one surface holding different things: a title on Library, a
   * segmented control on Browse, a search field as well on Search. So the
   * change is a change of height as much as of content, and fading the words in
   * and out on their own left the bar snapping between two sizes underneath
   * them.
   *
   * `LayoutAnimation` animates the thing that is actually changing — every
   * affected view's frame, measured before and after and interpolated by the
   * platform. What leaves fades out, what arrives fades in, and the bar's
   * height travels between the two instead of jumping.
   */
  const changeTab = (next: Tab) => {
    LayoutAnimation.configureNext({
      duration: 240,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
    setTab(next);
  };

 const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);

  /*
   * True while the pager is being driven rather than dragged.
   *
   * A press scrolls the pager, and the scroll then reports where it landed —
   * which on iOS arrived after the next render and set the tab to whatever page
   * the animation happened to be passing through. The flag makes the press the
   * single source of truth until its own animation has finished.
   */
  const driving = useRef(false);

  /**
   * The content's opacity, for jumps that are not a swipe.
   *
   * Sliding from Search to Settings would travel through People, and a tab
   * nobody asked for renders as it flies past. Cutting instead was correct but
   * abrupt — so a distant jump dissolves: out, move, in. Nothing travels, and
   * the bar above is untouched either way.
   */
  const fade = useRef(new Animated.Value(1)).current;

  const goTo = (next: Tab, dragging = false) => {
    const from = TABS.findIndex((entry) => entry.id === tab);
    const to = TABS.findIndex((entry) => entry.id === next);

    const near = Math.abs(to - from) === 1;

    driving.current = true;
    changeTab(next);

    // A finger already on its way to the answer needs no animation to explain
    // it; anything queued would still be arriving after the thumb had stopped.
    if (dragging) {
      pager.current?.scrollTo({ x: to * width, animated: false });
      return;
    }

    // Neighbours slide, because there is nothing in between to fly past.
    if (near) {
      pager.current?.scrollTo({ x: to * width, animated: true });
      return;
    }

    Animated.timing(fade, {
      toValue: 0,
      duration: 110,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      pager.current?.scrollTo({ x: to * width, animated: false });
      Animated.timing(fade, {
        toValue: 1,
        duration: 170,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    });
  };

  return (
    <View style={styles.fill}>
      {/*
        The five tabs, side by side, swipeable.

        They were already all mounted — a backup keeps its progress and the
        grids keep their scroll position when you move between them, which a
        plain swap would throw away mid-upload — so laying them out in a row
        costs nothing and makes the gesture everybody already tries work.
      */}
      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // The grids inside scroll vertically; without this a slightly diagonal
        // flick down a wall of photographs drags the whole tab sideways.
        directionalLockEnabled
        // No `contentOffset`: it is a live prop on iOS, not an initial value, so
        // it re-applied on every render and fought the scroll it had just been
        // told to make. The pager opens on Library, which is where it already
        // is, and every move after that goes through `goTo`.
        onScrollBeginDrag={() => {
          driving.current = false;
        }}
        onMomentumScrollEnd={(event) => {
          if (driving.current) {
            driving.current = false;
            return;
          }
          const landed = TABS[Math.round(event.nativeEvent.contentOffset.x / width)];
          if (landed && landed.id !== tab) changeTab(landed.id);
        }}
        style={[styles.fill, { opacity: fade }]}
      >
        <View style={{ width }}>
          <LibraryScreen serverUrl={serverUrl} />
        </View>
        <View style={{ width }}>
          <BrowseScreen serverUrl={serverUrl} folderId={null} />
        </View>
        <View style={{ width }}>
          <SearchScreen serverUrl={serverUrl} />
        </View>
        <View style={{ width }}>
          <PeopleScreen serverUrl={serverUrl} />
        </View>
        <View style={{ width }}>
          <SettingsScreen
            serverUrl={serverUrl}
            onChangeServer={onChangeServer}
            onSignOut={onSignOut}
          />
        </View>
      </Animated.ScrollView>

      {/*
        The one bar, above the pager and outside it.

        Nothing here moves when a tab slides past, because it is not on the tab
        — the tabs only say what should be in it. Settings has no bar of its
        own, so when it is showing there is simply nothing to render.
      */}

      <ServerBanner serverUrl={serverUrl} />

      <Tabs
        active={tab}
        onChange={(next, dragging) => {
          // A tab press is a request to be at that tab, not four levels inside
          // whatever was open over it.
          popToRoot();
          goTo(next, dragging);
        }}
      />

      {/* Pushed screens cover the tabs entirely, including the bar: a folder
          three levels down is not one of the five destinations, and leaving the
          bar visible would suggest tapping it goes back. Earlier entries stay
          mounted underneath so going back finds the list where it was left. */}
      {stack.map((entry) => (
        <PushedScreen key={entry.key} entry={entry}>
          <Screen
            route={entry.route}
            serverUrl={serverUrl}
            slot={`push:${entry.key}`}
            onBack={pop}
          />
        </PushedScreen>
      ))}

      {/*
        The one bar, over everything including the stack.

        Last in the tree and above it in z-order, so a pushed screen slides in
        underneath it rather than carrying a second bar across the top of it.
      */}
      {bar && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1000 }}>
          <Header {...bar}>{bar.below}</Header>
        </View>
      )}
    </View>
  );
}

function Screen({
  route,
  serverUrl,
  slot,
  onBack,
}: {
  route: Route;
  serverUrl: string;
  /** Where this screen publishes its bar, so the shell can show it. */
  slot: string;
  onBack: () => void;
}) {
  switch (route.name) {
    case 'folder':
      return (
        <BrowseScreen
          slot={slot}
          serverUrl={serverUrl}
          folderId={route.id}
          title={route.title}
          onBack={onBack}
        />
      );
    case 'album':
      return (
        <AlbumScreen
          slot={slot}
          serverUrl={serverUrl}
          albumId={route.id}
          title={route.title}
          onBack={onBack}
        />
      );
    case 'person':
      return (
        <PersonScreen
          slot={slot}
          serverUrl={serverUrl}
          personId={route.id}
          title={route.title}
          kind={route.kind}
          onBack={onBack}
        />
      );
    case 'place':
      return (
        <PlaceScreen
          slot={slot}
          serverUrl={serverUrl}
          city={route.city}
          title={route.title}
          onBack={onBack}
        />
      );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
