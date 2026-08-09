import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';
import { colors, radius, shadow } from '../theme';

/** The handle's size, and the rail it runs in. */
const HANDLE = 44;
const RAIL = 34;

/**
 * A way through a library that is years long.
 *
 * A grid of thousands has one honest problem: the only way to reach last March
 * is to keep flinging at it. The platform's own scroll indicator says where you
 * are and will not take you anywhere, so this replaces it with a handle you can
 * grab, and says what you are passing while you do.
 *
 * It appears when the content is longer than a couple of screens and there is
 * somewhere to go. On a folder of nine photographs it would be a control with
 * nothing to control.
 */
export function Scrubber({
  scrollY,
  contentHeight,
  viewportHeight,
  topInset,
  label,
  visible,
  onSeek,
  onDrag,
}: {
  /** The list's own offset, so the handle follows a normal scroll. */
  scrollY: Animated.Value;
  contentHeight: number;
  viewportHeight: number;
  /** Room the floating header takes, which the rail starts below. */
  topInset: number;
  /** What is under the handle right now — a date, usually. */
  label?: string;
  /** Only while the list is moving, or being dragged by the handle itself. */
  visible: boolean;
  onSeek: (offset: number) => void;
  onDrag: (dragging: boolean) => void;
}) {
  const travel = Math.max(0, contentHeight - viewportHeight);
  const railTop = topInset + 8;
  const railHeight = Math.max(0, viewportHeight - railTop - 120);
  const runway = Math.max(0, railHeight - HANDLE);

  /*
   * Where the handle sits, and where it was when the finger landed.
   *
   * The offset is read through a listener rather than from React state: the
   * gesture needs the current value on every move, and a state update per frame
   * would render the whole grid to move one small view.
   */
  const offset = useRef(0);
  const grabbed = useRef(0);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: visible ? 140 : 260,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, fade]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          grabbed.current = runway > 0 ? (offset.current / travel) * runway : 0;
          onDrag(true);
        },
        onPanResponderMove: (_, gesture) => {
          if (runway <= 0) return;
          const at = Math.min(runway, Math.max(0, grabbed.current + gesture.dy));
          onSeek((at / runway) * travel);
        },
        onPanResponderRelease: () => onDrag(false),
        onPanResponderTerminate: () => onDrag(false),
      }),
    [runway, travel, onSeek, onDrag],
  );

  scrollY.removeAllListeners();
  scrollY.addListener(({ value }) => {
    offset.current = value;
  });

  // Nowhere to go, or barely: the platform's own indicator is enough.
  if (travel < viewportHeight || runway <= 0) return null;

  const y = scrollY.interpolate({
    inputRange: [0, travel],
    outputRange: [0, runway],
    extrapolate: 'clamp',
  });

  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={{ position: 'absolute', top: railTop, right: 0, width: RAIL, height: railHeight }}
    >
      <Animated.View
        {...responder.panHandlers}
        style={{
          opacity: fade,
          position: 'absolute',
          right: 4,
          width: HANDLE,
          height: HANDLE,
          transform: [{ translateY: y }],
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: HANDLE / 2,
            backgroundColor: colors.raised,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            ...shadow(2),
          }}
        >
          {/* Two chevrons, the way every fast-scroll handle draws itself: it
              moves in both directions and says so without a word. */}
          <Chevron up />
          <Chevron />
        </View>
      </Animated.View>

      {label && (
        <Animated.View
          pointerEvents="none"
          style={{
            opacity: fade,
            position: 'absolute',
            right: RAIL + 8,
            transform: [{ translateY: y }],
            height: HANDLE,
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: radius.pill,
              backgroundColor: colors.raised,
              ...shadow(3),
            }}
          >
            <Text
              numberOfLines={1}
              style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}
            >
              {label}
            </Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <View
      style={{
        width: 9,
        height: 9,
        borderLeftWidth: 1.8,
        borderTopWidth: 1.8,
        borderColor: colors.muted,
        transform: [{ rotate: up ? '45deg' : '225deg' }],
        marginTop: up ? 2 : -2,
      }}
    />
  );
}

/** How far off the top counts as having scrolled. */
const AWAY = 12;

/**
 * Whether the list has been scrolled off the top, and the handler that says so.
 *
 * Not "is it moving". Both the date and the handle used to come and go with the
 * movement, which meant they blinked out every time a finger paused mid-flick —
 * and the date is the answer to "where am I", which does not stop being worth
 * knowing the moment the list is still. So they appear once the top of the list
 * has been left behind and stay for as long as it has.
 *
 * At the very top there is nothing to say: the newest photographs are where the
 * list opens, and neither a date nor a rail earns its place over them.
 */
export function useScrolledAway(): [boolean, (offset: number) => void] {
  const [away, setAway] = useState(false);

  const mark = useCallback((offset: number) => {
    setAway((was) => {
      const now = offset > AWAY;
      return now === was ? was : now;
    });
  }, []);

  return [away, mark];
}

/**
 * The date of whatever is at the top of the screen, under the bar.
 *
 * Google Photos does this and it is the right trade for a dense grid: a heading
 * above every day turns a wall of photographs into a list of dates, while one
 * label that keeps up with the scroll answers the same question — when am I? —
 * and costs no room in the grid at all.
 */
export function DateLabel({ children, visible }: { children: ReactNode; visible: boolean }) {
  const showing = visible && !!children;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(fade, {
      toValue: showing ? 1 : 0,
      duration: showing ? 140 : 260,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [showing, fade]);

  if (!children) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        opacity: fade,
        position: 'absolute',
        left: 16,
        borderRadius: radius.pill,
        paddingHorizontal: 13,
        paddingVertical: 6,
        backgroundColor: colors.raised,
        ...shadow(2),
      }}
    >
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{children}</Text>
    </Animated.View>
  );
}
