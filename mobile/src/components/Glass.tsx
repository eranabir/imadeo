import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors } from '../theme';

/**
 * Whether this device draws real liquid glass.
 *
 * True only on iOS 26 and later, in a binary built against the iOS 26 SDK —
 * the module answers `false` on Android and web without touching anything
 * native, so this is safe to evaluate once at module scope.
 */
export const liquidGlass = isLiquidGlassAvailable();

interface Props {
  children?: ReactNode;
  style?: ViewStyle;
  /** Rounds the material itself, not just what is drawn on top of it. */
  radius?: number;
  /** Colours the glass. Keep it faint; the material is doing the work. */
  tint?: string;
  /** Lets the glass react to touches. Cannot be changed after mount. */
  interactive?: boolean;
}

/**
 * A pane of glass, or the closest the device can get to one.
 *
 * Three ways down, in order of fidelity:
 *
 *  1. iOS 26 gets `GlassView`, the real material — it refracts and specular
 *     highlights along its edges as content moves underneath.
 *  2. Everything else gets `expo-blur`, which is a genuine backdrop blur on
 *     iOS 15+, Android and web. Not liquid glass, but still translucent.
 *  3. Reduced-transparency devices fall out of the blur to a flat surface.
 *
 * `GlassView` on its own is not enough: off iOS it renders a plain `View`, so a
 * tab bar built on it alone would be fully transparent and photographs would
 * scroll straight through the labels.
 */
export function Glass({ children, style, radius = 0, tint, interactive = false }: Props) {
  const shape: ViewStyle = {
    borderRadius: radius,
    // Without this the blur is a rectangle behind rounded content on Android.
    overflow: 'hidden',
  };

  if (liquidGlass) {
    return (
      <GlassView
        glassEffectStyle="regular"
        // The app is dark whatever the phone is set to, so the glass must not
        // follow the system and turn milky white over a dark grid.
        colorScheme="dark"
        // Liquid glass is nearly clear over a bright photograph, and a title
        // laid on nothing is a title nobody can read. The tint gives it a body
        // to sit on without taking the refraction away.
        tintColor={tint ?? colors.film}
        isInteractive={interactive}
        style={[shape, style]}
      >
        {children}
      </GlassView>
    );
  }

  const android = Platform.OS === 'android';

  return (
    <BlurView
      intensity={android ? 64 : 70}
      /**
       * The chrome material rather than a flat dark tint.
       *
       * Plain `dark` lays a heavy neutral wash over whatever is behind it, and
       * a bar built on it stops looking like glass and starts looking like a
       * slab of the background. `systemChromeMaterialDark` is what iOS puts
       * behind its own navigation and tab bars: lighter, and it picks up the
       * colour of the photographs passing underneath.
       */
      tint={Platform.OS === 'ios' ? 'systemChromeMaterialDark' : 'dark'}
      /**
       * Android does not blur at all unless asked.
       *
       * The default is `'none'`, which renders a flat translucent rectangle and
       * nothing else — so the bars were a slab of dark colour with no glass
       * anywhere in them, and every attempt to make the text readable only made
       * that slab heavier. `dimezisBlurView` is the real backdrop blur.
       */
      experimentalBlurMethod={android ? 'dimezisBlurView' : undefined}
      // Intensity is divided by this before reaching the Android blur; the
      // default of 4 leaves 64 looking like almost nothing.
      blurReductionFactor={android ? 2 : undefined}
      style={[shape, style]}
    >
      {/*
        The wash the bar's own content sits on.

        It has to be a layer rather than a `backgroundColor` on the blur itself:
        every platform's `BlurView` paints its own tint onto that node, so a
        colour passed in the style is simply overwritten and the bar keeps
        whatever the material gave it.
      */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.film }]} pointerEvents="none" />
      {children}
    </BlurView>
  );
}
