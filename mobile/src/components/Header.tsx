import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, wash } from '../theme';
import { Icon, type IconName } from './Icon';
import { Touchable } from './ui';

/** The bar's own height, above whatever the status bar takes. */
export const HEADER_HEIGHT = 60;

interface Props {
  title: string;
  subtitle?: string;
  /**
   * The section's glyph, on a primary plate beside the title.
   *
   * There is no per-section colour and no prop to set one. Every header in the
   * app is `colors.primary`.
   */
  icon?: IconName;
  /** Shows a back chevron. Omit on a tab's own screen, which has nowhere back. */
  onBack?: () => void;
  /** A single control on the right — a New button, a Rename, a filter. */
  action?: ReactNode;
  /** Search fields and segmented controls that belong to the bar, not the list. */
  children?: ReactNode;
}

/**
 * The bar every screen wears, solid and identical on all of them.
 *
 * It used to be glass, and what showed through it was whatever each screen
 * happened to be scrolling — so the same bar was a different colour on Library
 * than on Search, and over a pale photograph the title lost its background
 * entirely. One opaque surface means one bar, and a title that is legible over
 * anything because nothing gets behind it.
 *
 * The plate behind the section glyph is always the primary. An earlier version
 * gave each section its own hue; the palette is closed and nothing here picks
 * up a new colour.
 *
 * It still floats above the content, so every list below it has to open with
 * `headerClearance` worth of padding, or its first row starts life hidden.
 */
export function Header({ title, subtitle, icon, onBack, action, children }: Props) {
  const insets = useSafeAreaInsets();

  return (
    /**
     * The shadow lives out here, on a view that clips nothing.
     *
     * A shadow and `overflow: hidden` cannot share a node on iOS — the clip
     * takes the shadow with it — and the bar has to clip, or its surface
     * spills past the rounded bottom corners. So the two jobs are split: this
     * view casts, the one inside it clips.
     */
    <View
      style={[
        { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
        shadow(2),
      ]}
    >
      {/**
       * The corners are cut here, by an ordinary view.
       *
       * Square across the top and rounded along the bottom: the bar runs under
       * the status bar, so rounding those corners cuts two notches out of the
       * display edge.
       *
       * Asking the material to do it does not work. iOS 26's glass shapes
       * itself from `borderRadius` alone — the four individual corner props
       * never reach the native layer — so the bar came out square on iOS while
       * looking correct on Android. A plain parent that clips gives every
       * platform the same silhouette whatever is rendered inside it.
       */}
      <View
        style={{
          borderBottomLeftRadius: radius.xl,
          borderBottomRightRadius: radius.xl,
          overflow: 'hidden',
        }}
      >
    <View
      // No bottom border: the bar is opaque and already casts a shadow, and a
      // hairline inside the rounded clip read as a seam across the corners
      // rather than as an edge.
      style={{ backgroundColor: colors.surface, paddingTop: insets.top }}
    >
      <View
        style={{
          minHeight: HEADER_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: onBack ? 6 : 16,
          paddingRight: 14,
          gap: 10,
        }}
      >
        {onBack && (
          <Touchable
            onPress={onBack}
            radius={radius.pill}
            label="Back"
            style={{ width: 38, height: 38 }}
          >
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="back" size={21} color={colors.primary} strong />
            </View>
          </Touchable>
        )}

        {icon && (
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: radius.sm,
              backgroundColor: wash(colors.primary),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={icon} size={20} color={colors.primary} strong />
          </View>
        )}

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text
            numberOfLines={1}
            style={{
              color: colors.text,
              fontSize: onBack ? 18 : 21,
              fontWeight: '700',
              letterSpacing: -0.5,
            }}
          >
            {title}
          </Text>
          {subtitle && (
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
              {subtitle}
            </Text>
          )}
        </View>

        {action}
      </View>

      {children}
    </View>
      </View>
    </View>
  );
}

/**
 * How far a list has to start below the top of the screen.
 *
 * `extra` covers anything passed into the header as children — a search field,
 * a row of chips — which the header sizes itself around but a list cannot see.
 */
export function useHeaderClearance(extra = 0) {
  const insets = useSafeAreaInsets();
  return insets.top + HEADER_HEIGHT + extra + 8;
}

/**
 * The pill-shaped control that sits at the right of a header.
 *
 * Its own component because there are four of them across the app and they had
 * already drifted — one was a bare glyph with no hit area worth the name.
 */
export function HeaderAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
}) {
  return (
    <Touchable onPress={onPress} radius={radius.pill} label={label}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingHorizontal: 13,
          paddingVertical: 8,
          borderRadius: radius.pill,
          backgroundColor: wash(colors.primary),
        }}
      >
        {icon && <Icon name={icon} size={15} color={colors.primary} strong />}
        <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700' }}>{label}</Text>
      </View>
    </Touchable>
  );
}
