import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, shadow } from '../theme';

const diameter = 44;
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

export function PhotoScrollHandle({ scrollY, viewport, content, topInset, onSeek }: {
  scrollY: Animated.Value;
  viewport: number;
  content: number;
  topInset: number;
  onSeek: (offset: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const top = topInset + 6;
  const runway = viewport - top - insets.bottom - diameter - 6;
  const travel = content - viewport;
  const offset = useRef(0);
  const grab = useRef(0);
  const [dragging, setDragging] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;
  const latest = useRef({ onSeek, travel, runway });
  latest.current = { onSeek, travel, runway };

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => { offset.current = value; });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  const responder = useMemo(() => {
    const move = (dy: number) => {
      const { runway, travel, onSeek } = latest.current;
      if (runway <= 0 || travel <= 0) return;
      const y = clamp(grab.current + dy, runway);
      dragY.setValue(y);
      onSeek(y / runway * travel);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const { travel, runway } = latest.current;
        grab.current = clamp(offset.current / travel, 1) * runway;
        dragY.setValue(grab.current);
        setDragging(true);
      },
      onPanResponderMove: (_, gesture) => move(gesture.dy),
      onPanResponderRelease: (_, gesture) => { move(gesture.dy); setDragging(false); },
      onPanResponderTerminate: () => setDragging(false),
    });
  }, [dragY]);

  if (viewport <= 0 || travel <= 1 || runway <= 0) return null;
  const y = scrollY.interpolate({ inputRange: [0, travel], outputRange: [0, runway], extrapolate: 'clamp' });
  return <Animated.View {...responder.panHandlers} accessible accessibilityRole="adjustable"
    accessibilityLabel="Photo scroller" accessibilityHint="Drag up or down to scroll through photos."
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    onAccessibilityAction={({ nativeEvent }) => onSeek(clamp(offset.current + (nativeEvent.actionName === 'increment' ? viewport : -viewport), travel))}
    style={{ position: 'absolute', top, right: insets.right + 4, width: diameter, height: diameter,
      borderRadius: diameter / 2, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.raised,
      alignItems: 'center', justifyContent: 'center', gap: 3, ...shadow(2),
      transform: [{ translateY: dragging ? dragY : y }] }}>
    {[true, false].map(up => <View key={String(up)} pointerEvents="none" style={{ width: 9, height: 9,
      borderLeftWidth: 1.8, borderTopWidth: 1.8, borderColor: colors.muted, marginTop: up ? 2 : -2,
      transform: [{ rotate: up ? '45deg' : '225deg' }] }} />)}
  </Animated.View>;
}
