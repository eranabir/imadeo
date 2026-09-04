import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  clamp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const MAX_SCALE = 5;
const REST_SCALE = 1.01;
const SPRING = { damping: 22, stiffness: 220, overshootClamping: true };

interface Props {
  children: ReactNode;
  width: number;
  height: number;
  active?: boolean;
  accessibilityLabel?: string;
  onTap?: () => void;
  /** Locks the surrounding paged gallery while this media owns horizontal movement. */
  onZoomChange?: (zoomed: boolean) => void;
}

/**
 * Native photo-viewer gestures shared by server and device media.
 *
 * Pinch follows its focal point, a magnified item can be panned, and double
 * tap toggles a useful 2.5x zoom. The parent gallery is only locked while a
 * pinch is active or the item remains above 1x, so ordinary swiping still
 * changes photos instead of fighting this view.
 */
export function ZoomableMedia({
  children,
  width,
  height,
  active = true,
  accessibilityLabel,
  onTap,
  onZoomChange,
}: Props) {
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const [panEnabled, setPanEnabled] = useState(false);
  const [pagingLocked, setPagingLocked] = useState(false);
  const zoomChange = useRef(onZoomChange);
  const isActive = useRef(active);

  useEffect(() => {
    zoomChange.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => {
    isActive.current = active;
    if (active) zoomChange.current?.(pagingLocked);
  }, [active, pagingLocked]);

  useEffect(
    () => () => {
      if (isActive.current) zoomChange.current?.(false);
    },
    [],
  );

  // A neighbouring virtualised page must never remember zoom when revisited.
  useEffect(() => {
    if (active) return;
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    setPanEnabled(false);
    setPagingLocked(false);
  }, [active, scale, translateX, translateY]);

  // Orientation and window-size changes invalidate the transform. Toolbar
  // visibility deliberately does not change this viewport, so ordinary taps
  // never reset or reposition the media.
  useEffect(() => {
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    setPanEnabled(false);
    setPagingLocked(false);
  }, [height, scale, translateX, translateY, width]);

  const pinch = Gesture.Pinch()
    .enabled(active)
    .onStart((event) => {
      startScale.value = scale.value;
      startX.value = translateX.value;
      startY.value = translateY.value;
      focalX.value = event.focalX - width / 2;
      focalY.value = event.focalY - height / 2;
      runOnJS(setPagingLocked)(true);
    })
    .onUpdate((event) => {
      const nextScale = clamp(startScale.value * event.scale, 1, MAX_SCALE);
      const ratio = nextScale / startScale.value;
      const maxX = (width * nextScale - width) / 2;
      const maxY = (height * nextScale - height) / 2;

      scale.value = nextScale;
      translateX.value = clamp(
        focalX.value - (focalX.value - startX.value) * ratio,
        -maxX,
        maxX,
      );
      translateY.value = clamp(
        focalY.value - (focalY.value - startY.value) * ratio,
        -maxY,
        maxY,
      );
    })
    .onFinalize(() => {
      if (scale.value <= REST_SCALE) {
        scale.value = withSpring(1, SPRING);
        translateX.value = withSpring(0, SPRING);
        translateY.value = withSpring(0, SPRING);
        runOnJS(setPanEnabled)(false);
        runOnJS(setPagingLocked)(false);
        return;
      }

      const nextScale = clamp(scale.value, 1, MAX_SCALE);
      const maxX = (width * nextScale - width) / 2;
      const maxY = (height * nextScale - height) / 2;
      scale.value = withSpring(nextScale, SPRING);
      translateX.value = withSpring(clamp(translateX.value, -maxX, maxX), SPRING);
      translateY.value = withSpring(clamp(translateY.value, -maxY, maxY), SPRING);
      runOnJS(setPanEnabled)(true);
      runOnJS(setPagingLocked)(true);
    });

  const pan = Gesture.Pan()
    .enabled(active && panEnabled)
    .minDistance(2)
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      const maxX = (width * scale.value - width) / 2;
      const maxY = (height * scale.value - height) / 2;
      translateX.value = clamp(startX.value + event.translationX, -maxX, maxX);
      translateY.value = clamp(startY.value + event.translationY, -maxY, maxY);
    });

  const doubleTap = Gesture.Tap()
    .enabled(active)
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((event, success) => {
      if (!success) return;
      if (scale.value > REST_SCALE) {
        scale.value = withSpring(1, SPRING);
        translateX.value = withSpring(0, SPRING);
        translateY.value = withSpring(0, SPRING);
        runOnJS(setPanEnabled)(false);
        runOnJS(setPagingLocked)(false);
        return;
      }

      const nextScale = 2.5;
      const tapX = event.x - width / 2;
      const tapY = event.y - height / 2;
      const maxX = (width * nextScale - width) / 2;
      const maxY = (height * nextScale - height) / 2;
      scale.value = withSpring(nextScale, SPRING);
      translateX.value = withSpring(clamp(-tapX * (nextScale - 1), -maxX, maxX), SPRING);
      translateY.value = withSpring(clamp(-tapY * (nextScale - 1), -maxY, maxY), SPRING);
      runOnJS(setPanEnabled)(true);
      runOnJS(setPagingLocked)(true);
    });

  const singleTap = Gesture.Tap()
    .enabled(active)
    .numberOfTaps(1)
    .onEnd((_event, success) => {
      if (success && onTap) runOnJS(onTap)();
    });

  const gesture = Gesture.Simultaneous(
    pinch,
    pan,
    Gesture.Exclusive(doubleTap, singleTap),
  );
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View
        accessible
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Pinch or double tap to zoom"
        style={{ width, height, overflow: 'hidden' }}
      >
        <Reanimated.View
          style={[
            { width, height, alignItems: 'center', justifyContent: 'center' },
            animatedStyle,
          ]}
        >
          {children}
        </Reanimated.View>
      </Reanimated.View>
    </GestureDetector>
  );
}
