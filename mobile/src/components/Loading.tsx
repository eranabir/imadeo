import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { colors, radius } from '../theme';

/** Uneven, so it reads as photographs rather than a grid of buttons. */
const TILES = [
  { w: 84, h: 56 },
  { w: 64, h: 56 },
  { w: 96, h: 56 },
];

/**
 * One tile breathing on its own offset.
 *
 * Each placeholder owns its animation rather than sharing one clock, because
 * the stagger is the whole effect — three tiles pulsing in unison is a loading
 * bar, three arriving one after another is a page forming.
 */
function Tile({ width, height, delay }: { width: number; height: number; delay: number }) {
  const beat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(beat, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(beat, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [beat, delay]);

  return (
    <Animated.View
      style={{
        width,
        height,
        borderRadius: radius.sm,
        backgroundColor: colors.surface,
        // The same 0.45 → 0.9 and −3px lift the web client shimmers with.
        opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }),
        transform: [
          { translateY: beat.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) },
        ],
      }}
    />
  );
}

/**
 * The app's loading state.
 *
 * A few blank frames settling into place — the shape of what is arriving,
 * rather than a spinner announcing the *idea* of waiting. Deliberately quiet:
 * waiting should feel like the page is already forming, not like a separate
 * screen has interrupted it.
 *
 * Deliberately the same three tiles, timings and easing as the web client's
 * `Loading`, so the two clients wait in the same way.
 */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View
      style={{ alignItems: 'center', paddingVertical: 72, gap: 20 }}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        {TILES.map((tile, index) => (
          <Tile key={index} width={tile.w} height={tile.h} delay={index * 180} />
        ))}
      </View>
      <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
    </View>
  );
}

/**
 * Placeholder tiles in the shape of the grid that is coming.
 *
 * For the screens that are a wall of photographs, where three small frames in
 * the middle of an empty page would say less than the page's own outline does.
 */
export function GridSkeleton({ rows = 4, columns = 3 }: { rows?: number; columns?: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading photos">
      {Array.from({ length: rows }).map((_, row) => (
        <View key={row} style={{ flexDirection: 'row' }}>
          {Array.from({ length: columns }).map((__, column) => (
            <View key={column} style={{ flex: 1 / columns, aspectRatio: 1, padding: 1 }}>
              <Pulse delay={(row * columns + column) * 80} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** A single square, breathing between 0.5 and 0.85 like the web's pulse. */
function Pulse({ delay }: { delay: number }) {
  const beat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(beat, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(beat, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [beat, delay]);

  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: colors.surface,
        opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.85] }),
      }}
    />
  );
}
