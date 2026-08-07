import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { colors } from './theme';

/**
 * Somewhere the app can go on top of whichever tab is showing.
 *
 * Every route carries the title it will display. The screen could fetch its own
 * name, but then a pushed screen opens blank-headed for as long as the request
 * takes, and the back gesture reveals a header that only fills in afterwards.
 * The caller already knows the name — it was on the card that was tapped.
 */
export type Route =
  | { name: 'folder'; id: string | null; title: string }
  | { name: 'album'; id: string; title: string }
  | { name: 'person'; id: string; title: string };

export interface Entry {
  route: Route;
  /** Stable across re-renders, so a screen is not remounted by its neighbours. */
  key: number;
  /** Animating out. Still mounted, no longer part of the history. */
  leaving: boolean;
}

interface Navigation {
  stack: Entry[];
  push: (route: Route) => void;
  pop: () => void;
  /** Back to the tab underneath, however deep the stack has gone. */
  popToRoot: () => void;
  /** Drops a screen once its exit animation has finished. */
  settle: (key: number) => void;
}

const NavigationContext = createContext<Navigation | null>(null);

/** How long a screen takes to slide back off. */
const EXIT_MS = 200;

/**
 * A stack of screens over the tabs, hand-rolled rather than react-navigation.
 *
 * The app needs one thing a navigator gives: push a screen, come back, find the
 * list where it was left. That is an array and two functions. React Navigation
 * would add a native-screens dependency, a linking configuration and a theme to
 * keep in sync with `theme.ts`, for behaviour the tab bar already does without.
 *
 * The moment this needs modal presentation, deep links or per-tab history, it
 * should be thrown away for the real thing rather than grown into one.
 */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Entry[]>([]);
  const nextKey = useRef(1);

  const push = useCallback((route: Route) => {
    setStack((s) => [...s, { route, key: nextKey.current++, leaving: false }]);
  }, []);

  /**
   * Marks the top screen as leaving rather than dropping it.
   *
   * Unmounting immediately would take the view away before it could animate
   * off, so back would be a jump cut while forward slid. `settle` removes it
   * once the animation reports it is done.
   */
  const pop = useCallback(() => {
    setStack((s) => {
      let last = -1;
      for (let i = s.length - 1; i >= 0; i -= 1) {
        if (!s[i].leaving) {
          last = i;
          break;
        }
      }
      if (last === -1) return s;
      return s.map((entry, i) => (i === last ? { ...entry, leaving: true } : entry));
    });
  }, []);

  const popToRoot = useCallback(() => {
    setStack((s) => s.map((entry) => ({ ...entry, leaving: true })));
  }, []);

  const settle = useCallback((key: number) => {
    setStack((s) => s.filter((entry) => entry.key !== key));
  }, []);

  // Android's back gesture and button have to unwind the stack before they are
  // allowed to close the app. Returning false at the root hands the press back
  // to the system, which is what makes leaving the app still work.
  const depth = stack.filter((entry) => !entry.leaving).length;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (depth === 0) return false;
      pop();
      return true;
    });
    return () => subscription.remove();
  }, [depth, pop]);

  const value = useMemo(
    () => ({ stack, push, pop, popToRoot, settle }),
    [stack, push, pop, popToRoot, settle],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('useNavigation was called outside NavigationProvider');
  return value;
}

/**
 * One screen sliding in over the tabs, and back off again.
 *
 * The transition is not decoration. Without it a folder four levels deep opens
 * and closes with no sense of direction, and the screen underneath is simply
 * replaced — which reads as the app having glitched rather than moved.
 *
 * `elevation` matters as much as `zIndex`: on Android the drawing order of
 * overlapping siblings follows elevation before tree order, so a bar with any
 * elevation of its own would otherwise punch through a screen laid over it.
 */
export function PushedScreen({
  entry,
  children,
}: {
  entry: Entry;
  children: ReactNode;
}) {
  const { settle } = useNavigation();
  const { width } = useWindowDimensions();
  const slide = useRef(new Animated.Value(width)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slide]);

  useEffect(() => {
    if (!entry.leaving) return;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      settle(entry.key);
    };

    Animated.timing(slide, {
      toValue: width,
      duration: EXIT_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(release);

    /**
     * The screen must go even if the animation never reports back.
     *
     * A driver that stops running takes the completion callback with it, and
     * this view is an opaque absolute fill sitting above everything — so a
     * missed callback is not a missed animation, it is a dead screen pinned
     * over the app with no way back. It happens whenever frames stop:
     * backgrounding the tab on web is enough to do it.
     */
    const failsafe = setTimeout(release, EXIT_MS + 250);
    return () => clearTimeout(failsafe);
  }, [entry.leaving, entry.key, slide, width, settle]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: colors.bg,
          transform: [{ translateX: slide }],
          zIndex: 100 + entry.key,
          elevation: 100 + entry.key,
        },
        // A leading edge, so the screen reads as a sheet over the one behind it
        // rather than a repaint of the same surface.
        Platform.OS === 'ios'
          ? {
              shadowColor: '#000',
              shadowOpacity: 0.45,
              shadowRadius: 14,
              shadowOffset: { width: -4, height: 0 },
            }
          : null,
      ]}
    >
      {children}
    </Animated.View>
  );
}
