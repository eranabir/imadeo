import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { useSelectionBar } from '../selection';
import { motion } from '../theme';

/** The selected-media toolbar, owned by the active route rather than UIKit. */
export function SelectionDock() {
  const { dock } = useSelectionBar();
  const [shown, setShown] = useState<ReactNode>(dock);
  const enter = useRef(new Animated.Value(dock ? 1 : 0)).current;
  const visible = Boolean(dock);

  useEffect(() => { if (dock) setShown(dock); }, [dock]);

  useEffect(() => {
    const animation = Animated.timing(enter, {
      toValue: visible ? 1 : 0,
      duration: visible ? motion.enter : motion.exit,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    animation.start(({ finished }) => {
      if (finished && !visible) setShown(null);
    });

    return () => animation.stop();
  }, [visible, enter]);

  if (!shown) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [160, 0] }) },
          ],
        },
      ]}
    >
      {dock || shown}
    </Animated.View>
  );
}
