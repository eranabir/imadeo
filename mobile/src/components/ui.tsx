import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';
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
  tall = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Holds the panel at a fixed height instead of letting it fit its content.
   *
   * For sheets whose body is a list that changes length — folding a folder or
   * typing a search made the whole panel jump up and down under the finger,
   * and the row being aimed at moved with it.
   */
  tall?: boolean;
}) {

  /**
   * The panel rises; the backdrop fades. Two things, not one.
   *
   * `Modal`'s own `animationType="slide"` moves everything it contains,
   * backdrop included, so the dimming swept up from the bottom edge like a page
   * being pushed on — which is what it looked like, rather than a panel coming
   * up over the screen you are still on. Animating both here keeps the modal
   * itself still and lets each part do the one thing it should.
   *
   * `shown` lags `open` so there is something left on screen to animate out.
   */
  const [shown, setShown] = useState(open);
  const enter = useRef(new Animated.Value(0)).current;

  /**
   * Everything moving this panel runs on the JS driver.
   *
   * The finger's position arrives as `setValue` on `drag`, and `drag` is added
   * to `enter` to make one translation — so if `enter` were native, the sum
   * would be a native node and the JS writes to `drag` would never reach the
   * view. It looked exactly like a dead gesture. A single sheet's opacity and
   * translation are cheap enough to animate from JS.
   */
  const NATIVE = false;

  /**
   * Dragged down to dismiss.
   *
   * A sheet that rises from the bottom edge invites being pushed back to it,
   * and on both platforms that is the gesture people try first — the grabber is
   * a promise the panel was not keeping. Only the head is draggable: the body
   * scrolls, and a list that dismissed the sheet every time it was flicked
   * downwards would be unusable.
   */
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      drag.setValue(0);
      setShown(true);
      Animated.timing(enter, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: NATIVE,
      }).start();
      return;
    }

    Animated.timing(enter, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start(({ finished }) => {
      if (finished) setShown(false);
    });
  }, [open, drag, enter]);

  const grip = useRef(
    PanResponder.create({
      /*
       * Claimed the moment a finger lands on the head.
       *
       * Negotiating on move — the tidier-looking option — never fired: by the
       * time the gesture was worth claiming the touch had already been settled
       * elsewhere, on both platforms. There is nothing in the head to press
       * anyway: a grabber, a title and a line of description, no controls. The
       * list below keeps its own touches, which is what matters.
       */
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Nothing may take the drag away once it has started.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        // Downwards only. Dragging up would lift the panel off the bottom edge
        // and show the backdrop beneath it.
        if (gesture.dy > 0) drag.setValue(gesture.dy);
      },
      onPanResponderRelease: (_event, gesture) => {
        // Either far enough or fast enough: a short flick means the same thing
        // as a long push, and demanding both feels stuck.
        if (gesture.dy > 110 || gesture.vy > 0.9) {
          Animated.timing(drag, {
            toValue: TRAVEL,
            duration: 180,
            easing: Easing.out(Easing.quad),
            useNativeDriver: NATIVE,
          }).start(onClose);
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: NATIVE, bounciness: 2 }).start();
        }
      },
    }),
  ).current;

  if (!shown) return null;

  // Further than any sheet is tall, so one constant covers every panel: it only
  // has to be off the bottom of the screen.
  const lift = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [TRAVEL, 0] }),
    drag,
  );

  return (
    <Modal transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* Tapping the dimmed area is how a sheet is dismissed on both
            platforms, and it has to be a sibling of the panel — a panel nested
            inside the backdrop would swallow every press meant for it. */}
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.backdrop,
            opacity: enter,
          }}
        >
          <Pressable onPress={onClose} accessibilityLabel="Close" style={{ flex: 1 }} />
        </Animated.View>

        <Animated.View
          style={[
            {
              backgroundColor: colors.raised,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingTop: 10,
              paddingBottom: Math.max(HOME_INDICATOR, 16),
              ...(tall ? { height: '85%' } : { maxHeight: '85%' }),
              transform: [{ translateY: lift }],
            },
            shadow(3),
          ]}
        >
          {/* The head is the handle: grabber, title and description together,
              so there is a comfortable band to pull rather than a 4pt bar. */}
          <View {...grip.panHandlers}>
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
              <Text
                style={{ color: colors.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.4 }}
              >
                {title}
              </Text>
              {description && (
                <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 5 }}>
                  {description}
                </Text>
              )}
            </View>
          </View>

          <ScrollView
            style={tall ? { flex: 1 } : { flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {footer && <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>{footer}</View>}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** How far a sheet travels on its way in and out — past the bottom of any phone. */
const TRAVEL = 900;

/**
 * The bar at the bottom of the phone, and nothing else.
 *
 * `useSafeAreaInsets` inside a tab is not the window's inset: the tab navigator
 * puts its own bar into the context so that screens lay out above it, which on
 * this phone makes the bottom inset 83 rather than the 34 the home indicator
 * takes. A sheet is a modal over the whole window — the tab bar is behind it,
 * not under it — so padding for both left a white band under every confirmation
 * the height of a bar that was not there.
 */
const HOME_INDICATOR = initialWindowMetrics?.insets.bottom ?? 0;

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

/**
 * An on/off switch, drawn rather than taken from the platform.
 *
 * React Native's `Switch` picks up the system accent and the light appearance,
 * which on a screen that is dark on every phone reads as a control belonging to
 * something else. This one is the app's own primary, and the knob's travel is
 * the whole animation.
 */
export function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const slide = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: on ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [on, slide]);

  return (
    <Pressable
      onPress={() => onChange(!on)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      hitSlop={8}
      style={{
        width: 50,
        height: 30,
        borderRadius: radius.pill,
        padding: 3,
        backgroundColor: on ? colors.primary : colors.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Animated.View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: on ? colors.onPrimary : colors.muted,
          transform: [
            { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) },
          ],
        }}
      />
    </Pressable>
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
