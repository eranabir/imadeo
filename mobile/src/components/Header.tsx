import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useContext, type ReactNode } from 'react';
import { NativeHeaderContext } from './NativeTabStack';
import { NativeHeader, NATIVE_HEADING_HEIGHT } from './NativeHeader';
import { Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, wash } from '../theme';
import { Icon, type IconName } from './Icon';
import { Touchable } from './ui';

/** The bar's own height, above whatever the status bar takes. */
export const HEADER_HEIGHT = 60;

export interface HeaderConfig {
  title: string;
  subtitle?: string;
  /** Compact screens can opt into a smaller supporting line. */
  subtitleSize?: number;
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
  /** Anything that hangs under the title — a segmented control, a search field. */
  below?: ReactNode;
}

interface Props extends HeaderConfig {
  /**
   * The account button, in the far corner.
   *
   * Separate from `action` because it is not the screen's: it says whose
   * library this is and is the same on every tab, so a screen that already has
   * a New button does not have to choose between the two.
   */
  account?: ReactNode;
  /** Search fields and segmented controls that belong to the bar, not the list. */
  children?: ReactNode;
}

/** A floating toolbar contained entirely within the current safe content area. */
export function Header({
  title,
  subtitle,
  subtitleSize,
  icon,
  onBack,
  action,
  account,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const native = useContext(NativeHeaderContext);
  if (native) return <NativeHeader title={title} subtitle={subtitle} onBack={onBack} action={action}
    account={account} actionType={HeaderAction}>{children}</NativeHeader>;

  return (
    <View
      style={{
        position: 'absolute',
        top: insets.top + HEADER_TOP_GAP,
        left: insets.left + HEADER_SIDE_GAP,
        right: insets.right + HEADER_SIDE_GAP,
        zIndex: 10,
        backgroundColor: colors.surface,
        borderRadius: radius.lg,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          minHeight: HEADER_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: onBack ? 6 : 12,
          paddingRight: 12,
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

        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
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
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={{ color: colors.muted, fontSize: subtitleSize ?? 12.5, marginTop: 2 }}
            >
              {subtitle}
            </Text>
          )}
        </View>

        {action}
        {account}
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
  const native = useContext(NativeHeaderContext);
  const nativeHeight = useContext(HeaderHeightContext) ?? 0;
  if (native) return nativeHeight + NATIVE_HEADING_HEIGHT + extra + 4;
  // `HEADER_GAP` covers both the row added inside the bar and the space between
  // the bar and the content, which used to be 8pt — close enough that a title
  // and the first row of thumbnails read as one block.
  return insets.top + HEADER_TOP_GAP + HEADER_HEIGHT + extra + HEADER_GAP;
}

/** The bar's own bottom row, and the same distance again below it. */
const HEADER_GAP = 26;
const HEADER_TOP_GAP = 8;
const HEADER_SIDE_GAP = 12;

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
  compact: requestedCompact = false,
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
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = requestedCompact || Boolean(icon && width - insets.left - insets.right < 430);
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
