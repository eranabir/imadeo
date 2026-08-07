import { Platform, type ViewStyle } from 'react-native';

/**
 * Matches the web client's dark palette so the two do not look like siblings.
 *
 * Primary is Sky and secondary its lighter partner — the same pair the web
 * client and the marketing pages use, so all three read as one product.
 */
export const colors = {
  bg: '#0d1418',
  surface: '#141e24',
  /** A step above `surface`, for cards that sit on top of it. */
  raised: '#1b272e',
  /** Pressed state on Android, where the ripple needs something to sit on. */
  pressed: '#22323b',
  border: '#24333c',
  text: '#e8eff2',
  muted: '#93a6b1',
  faint: '#5f7480',
  /** The one colour that means "this is the thing": selected tabs, primary
   *  buttons, links. */
  primary: '#3fc9ff',
  /** Primary's lighter partner. Only ever the far end of a gradient — on its
   *  own it has too little contrast to carry text or an icon. */
  secondary: '#7cdbff',
  /** Legible on top of `primary`, which is far too light for white text. */
  onPrimary: '#04202e',
  danger: '#f43f5e',
  /** Behind a blur that is too light on its own to carry text. */
  scrim: 'rgba(13, 20, 24, 0.55)',
  /**
   * The wash every bar sits on, over whatever material the platform gives it.
   *
   * It was a pale lift at 0.16, tuned against an Android build that had no blur
   * at all and looked like a flat slab. On iOS, with photographs running under
   * the bar, that same film left the title unreadable — a bar you can see a
   * dog through is not a bar. Dark and substantial enough to carry white text
   * over any photograph, and still short of opaque.
   */
  film: 'rgba(13, 20, 24, 0.62)',
  /** Over a photograph, where nothing from the palette has enough contrast. */
  overlay: 'rgba(0, 0, 0, 0.45)',
  /** Behind a sheet, dimming everything the sheet is not. */
  backdrop: 'rgba(0, 0, 0, 0.62)',
};

/** The brand ramp from the app icon, for anything that should feel primary. */
export const BRAND = ['#7cdbff', '#3fc9ff', '#0369a1'] as const;

/**
 * The palette is closed.
 *
 * Every icon, title and header plate in the app uses `primary`. An earlier
 * version gave each section its own hue — violet for folders, amber for albums
 * — copied from the web client's navigation rail. It was not asked for and is
 * gone. Nothing here gains a colour without being asked for first.
 */
export const wash = (hex: string) => `${hex}36`;

/** Android's ripple, tuned to be visible on a dark surface without flashing. */
export const ripple = { color: 'rgba(232, 239, 242, 0.11)', borderless: false };

/**
 * Depth, expressed the way each platform actually draws it.
 *
 * Android ignores `shadow*` entirely and iOS ignores `elevation`, so a card
 * styled for one is flat on the other. Everything raised in this app goes
 * through here — the Android build looking flat was exactly this missing.
 */
export function shadow(level: 1 | 2 | 3): ViewStyle {
  if (Platform.OS === 'android') return { elevation: level * 3 };
  const spec = {
    1: { opacity: 0.22, radius: 5, y: 2 },
    2: { opacity: 0.3, radius: 12, y: 5 },
    3: { opacity: 0.4, radius: 22, y: 10 },
  }[level];
  return {
    shadowColor: '#000',
    shadowOpacity: spec.opacity,
    shadowRadius: spec.radius,
    shadowOffset: { width: 0, height: spec.y },
  };
}

/**
 * Room for the floating tab bar at the bottom of every scrolling list.
 *
 * The bar is glass and content passes under it, so a grid that stops at the
 * screen edge leaves its last row permanently half-hidden.
 */
export const TAB_BAR_CLEARANCE = 104;

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 };
