import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing } from 'react-native';

/** Where a tile sat when it was tapped, so the photograph can grow out of it. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A photograph that comes up out of the tile it was tapped on, and goes back.
 *
 * A fade would tell you a new screen had arrived; this tells you which
 * photograph you are looking at, because it is the one that just came up off
 * the grid. The tile's place is measured at the moment of the tap and the whole
 * pager is moved and scaled from there — a transform is visual only, so the
 * list underneath still pages by the screen's width and nothing has to know.
 *
 * Shared by both viewers. The device grid and the server grid are the same
 * gesture, and an animation that only half the app had would read as one of the
 * two being unfinished.
 */
export function useGrowFrom(origin: Rect | null, open: boolean) {
  /*
   * Measured straight from the window, not through the hook.
   *
   * `useWindowDimensions` inside a modal came back before the modal's own
   * window had been laid out, which sized the pages to nothing.
   */
  const { width, height } = Dimensions.get('window');

  // Nought even when it opens already open: a viewer mounted by its parent the
  // moment a tile is tapped has an entrance to make, exactly like one that was
  // sitting there waiting for an index.
  const enter = useRef(new Animated.Value(0)).current;
  /** Lags `open`, so there is something left on screen to animate out. */
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(enter, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(enter, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [open, enter]);

  const between = (small: number, full: number) =>
    enter.interpolate({ inputRange: [0, 1], outputRange: [small, full] });

  return {
    /** Whether there is still anything to draw, animation included. */
    mounted,
    /** Nought on the grid, one full screen. Everything else hangs off it. */
    enter,
    /**
     * Where the photograph is on its way between the two.
     *
     * Without a tile to come from — the grid scrolled, or the measurement did
     * not answer in time — it steps in from just under full size instead, which
     * is a smaller promise but not a broken one.
     */
    grown: {
      transform: [
        { translateX: between(origin ? origin.x + origin.width / 2 - width / 2 : 0, 0) },
        { translateY: between(origin ? origin.y + origin.height / 2 - height / 2 : 0, 0) },
        { scale: between(origin ? origin.width / width : 0.92, 1) },
      ],
    },
  };
}
