import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND, colors, radius, ripple, shadow, wash } from '../theme';
import { Icon, type IconName } from './Icon';

/**
 * The one pressable in the app.
 *
 * Android expects a ripple that starts where the finger landed; iOS expects the
 * surface to dim. Using `opacity` for both is what made the Android build feel
 * like a website — the platform's own feedback was simply missing.
 */
export function Touchable({
  onPress,
  onLongPress,
  disabled,
  style,
  children,
  radius: corner = 0,
  label,
  role = 'button',
  selected,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** Clips the ripple. Android draws it square otherwise. */
  radius?: number;
  label?: string;
  role?: 'button' | 'tab' | 'link' | 'radio';
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected, checked: selected }}
      android_ripple={corner === 0 ? ripple : { ...ripple, radius: undefined }}
      style={({ pressed }) => [
        { borderRadius: corner, overflow: 'hidden' },
        // iOS gets the dim; Android already has the ripple and dimming on top
        // of it reads as a double response.
        pressed && Platform.OS !== 'android' ? { opacity: 0.62 } : null,
        disabled ? { opacity: 0.45 } : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** A raised surface. Everything grouped on a screen sits on one of these. */
export function Card({
  children,
  style,
  level = 1,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  level?: 1 | 2 | 3;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: Platform.OS === 'android' ? 0 : 1,
          borderColor: colors.border,
        },
        shadow(level),
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The primary action, in the brand ramp from the app icon.
 *
 * A flat primary fill was the same sky as the selected tab and the folder
 * icons, so nothing on a screen looked more important than anything else.
 */
export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const tint =
    variant === 'primary' ? colors.onPrimary : variant === 'danger' ? colors.danger : colors.text;

  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 15,
        paddingHorizontal: 20,
      }}
    >
      {busy ? (
        <ActivityIndicator color={tint} size="small" />
      ) : (
        icon && <Icon name={icon} size={18} color={tint} strong />
      )}
      <Text style={{ color: tint, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 }}>
        {label}
      </Text>
    </View>
  );

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled || busy}
      radius={radius.pill}
      label={label}
      style={[
        variant === 'primary' ? shadow(2) : null,
        variant === 'secondary'
          ? { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }
          : null,
        style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={BRAND} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          {body}
        </LinearGradient>
      ) : (
        body
      )}
    </Touchable>
  );
}

/**
 * A bottom sheet, which is where a phone puts a choice.
 *
 * Centre-screen dialogs are a desktop shape: on a tall phone they land under
 * the thumb's reach and above the keyboard at the same time. Anchoring to the
 * bottom edge keeps the controls where the hand already is.
 */
export function Sheet({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  if (!open) return null;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Tapping the dimmed area is how a sheet is dismissed on both
            platforms, and it has to be a sibling of the panel — a panel nested
            inside the backdrop would swallow every press meant for it. */}
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop }}
        />

        <View
          style={[
            {
              backgroundColor: colors.raised,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingTop: 10,
              paddingBottom: Math.max(insets.bottom, 16),
              maxHeight: '85%',
            },
            shadow(3),
          ]}
        >
          {/* The grabber says the panel is dismissable before anyone tries. */}
          <View
            style={{
              alignSelf: 'center',
              width: 38,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: colors.border,
              marginBottom: 14,
            }}
          />

          <View style={{ paddingHorizontal: 20, marginBottom: description ? 14 : 12 }}>
            <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.4 }}>
              {title}
            </Text>
            {description && (
              <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 5 }}>
                {description}
              </Text>
            )}
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {footer && <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>{footer}</View>}
        </View>
      </View>
    </Modal>
  );
}

/** One choice in a sheet: an icon, a label, and something it does. */
export function SheetRow({
  icon,
  label,
  hint,
  onPress,
  danger,
  disabled,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const tint = danger ? colors.danger : colors.text;
  return (
    <Touchable onPress={onPress} disabled={disabled} radius={radius.md} label={label}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 12 }}>
        <Icon name={icon} size={20} color={danger ? colors.danger : colors.muted} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: tint, fontSize: 16, fontWeight: '600' }}>{label}</Text>
          {hint && (
            <Text style={{ color: colors.faint, fontSize: 12.5, marginTop: 2 }}>{hint}</Text>
          )}
        </View>
      </View>
    </Touchable>
  );
}

/** A small toggleable label. Filters, kinds, anything with a few options. */
export function Chip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: IconName;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Touchable onPress={onPress} radius={radius.pill} label={label}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? wash(colors.primary) : 'transparent',
        }}
      >
        {icon && <Icon name={icon} size={14} color={active ? colors.primary : colors.muted} />}
        <Text
          style={{
            color: active ? colors.primary : colors.muted,
            fontSize: 13.5,
            fontWeight: active ? '700' : '500',
          }}
        >
          {label}
        </Text>
      </View>
    </Touchable>
  );
}
