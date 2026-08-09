import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { colors, radius } from '../theme';

const MARK = 128;
const HALF = MARK / 2;

/** One quarter of the real mark, arriving from its own corner. */
function MarkPiece({
  progress,
  left,
  top,
}: {
  progress: Animated.Value;
  left: boolean;
  top: boolean;
}) {
  const imageLeft = left ? 0 : -HALF;
  const imageTop = top ? 0 : -HALF;
  const fromX = imageLeft + (left ? -18 : 18);
  const fromY = imageTop + (top ? -18 : 18);

  return (
    <View
      style={{
        position: 'absolute',
        left: left ? 0 : HALF,
        top: top ? 0 : HALF,
        width: HALF,
        height: HALF,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          width: MARK,
          height: MARK,
          opacity: progress,
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [fromX, imageLeft] }) },
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [fromY, imageTop] }) },
          ],
        }}
      >
        <Image
          source={require('../../assets/splash-icon.png')}
          style={{ width: MARK, height: MARK }}
          contentFit="contain"
        />
      </Animated.View>
    </View>
  );
}

/**
 * The mark assembles like four photographs finding their place in an album.
 *
 * There is no loading copy to read and no spinner to decode: the app's actual
 * emblem performs the one short piece of motion, then comes to rest.
 */
export function Opening() {
  const pieces = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const settle = useRef(new Animated.Value(0)).current;
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const arrive = Animated.stagger(
      70,
      pieces.map((piece) =>
        Animated.spring(piece, {
          toValue: 1,
          damping: 13,
          stiffness: 165,
          mass: 0.75,
          useNativeDriver: true,
        }),
      ),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(settle, {
          toValue: 1,
          duration: 950,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(settle, {
          toValue: 0,
          duration: 950,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const rotate = Animated.loop(
      Animated.sequence([
        Animated.delay(420),
        Animated.timing(turn, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(700),
        Animated.timing(turn, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    arrive.start(({ finished }) => {
      if (finished) {
        breathe.start();
        rotate.start();
      }
    });
    return () => {
      arrive.stop();
      breathe.stop();
      rotate.stop();
    };
  }, [pieces, settle, turn]);

  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Opening Imadeo">
      <Animated.View
        style={{
          width: MARK,
          height: MARK,
          opacity: settle.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }),
          transform: [
            { translateY: settle.interpolate({ inputRange: [0, 1], outputRange: [2, -4] }) },
            { scale: settle.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) },
            { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        }}
      >
        <MarkPiece progress={pieces[0]} left top />
        <MarkPiece progress={pieces[1]} left={false} top />
        <MarkPiece progress={pieces[2]} left top={false} />
        <MarkPiece progress={pieces[3]} left={false} top={false} />
      </Animated.View>
    </View>
  );
}

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
