import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { useSelectionBar } from '../selection';

/** The selected-media toolbar, owned by the active route rather than UIKit. */
export function SelectionDock() {
  const { dock } = useSelectionBar();
  const [shown, setShown] = useState<ReactNode>(dock);
  const enter = useRef(new Animated.Value(dock ? 1 : 0)).current;

  useEffect(() => {
    if (dock) setShown(dock);

    const animation = Animated.timing(enter, {
      toValue: dock ? 1 : 0,
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
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [160, 0] }) },
          ],
        },
      ]}
    >
      {shown}
    </Animated.View>
  );
}
