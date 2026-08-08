import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, wash } from '../theme';
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
     * A surface of its own, rounded where it meets the page.
     *
     * Square across the top — the bar runs under the status bar, and rounding
     * those corners would cut two notches out of the display edge — and rounded
     * along the bottom, which is the only edge it actually has. No shadow and
     * no border: the change of colour is the edge.
     */
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        backgroundColor: colors.surface,
        borderBottomLeftRadius: radius.xl,
        borderBottomRightRadius: radius.xl,
        overflow: 'hidden',
        paddingTop: insets.top,
      }}
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

      {/* A row of air under the title before the bar's rounded edge. Without it
          the text sits on the curve, and it read as cramped everywhere the bar
          carried nothing else — a person, an album, a place, the library. */}
      <View style={{ height: 10 }} />

      {children}
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
  // `HEADER_GAP` covers both the row added inside the bar and the space between
  // the bar and the content, which used to be 8pt — close enough that a title
  // and the first row of thumbnails read as one block.
  return insets.top + HEADER_HEIGHT + extra + HEADER_GAP;
}

/** The bar's own bottom row, and the same distance again below it. */
const HEADER_GAP = 26;

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
  compact = false,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  /**
   * Draws the icon alone, with the label left to screen readers.
   *
   * For the secondary of two actions. A bar wide enough for one labelled pill
   * is not wide enough for two, and the title is what gets squeezed out — it
   * collapsed to a single character before this existed.
   */
  compact?: boolean;
}) {
  return (
    <Touchable onPress={onPress} radius={radius.pill} label={label}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          paddingHorizontal: compact ? 0 : 13,
          paddingVertical: compact ? 0 : 8,
          width: compact ? 38 : undefined,
          height: compact ? 38 : undefined,
          borderRadius: radius.pill,
          backgroundColor: wash(colors.primary),
        }}
      >
        {icon && <Icon name={icon} size={compact ? 17 : 15} color={colors.primary} strong />}
        {!compact && (
          <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '700' }}>{label}</Text>
        )}
      </View>
    </Touchable>
  );
}
