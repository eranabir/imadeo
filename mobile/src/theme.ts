import { Platform, type ViewStyle } from 'react-native';

/**
 * Matches the web client's palettes so the two do not look like siblings.
 *
 * Primary is Sky and secondary its lighter partner — the same pair the web
 * client and the marketing pages use, so all three read as one product. The
 * light sheet is the web's own light theme, converted from the oklch values in
 * `app/src/index.css`; no hue here was invented for this app.
 */
export interface Palette {
  bg: string;
  surface: string;
  /** A step above `surface`, for cards that sit on top of it. */
  raised: string;
  /** Pressed state on Android, where the ripple needs something to sit on. */
  pressed: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  /** The one colour that means "this is the thing": selected tabs, primary
   *  buttons, links. */
  primary: string;
  /** Primary's lighter partner. Only ever the far end of a gradient — on its
   *  own it has too little contrast to carry text or an icon. */
  secondary: string;
  /** Legible on top of `primary`. */
  onPrimary: string;
  danger: string;
  /** "Answering" — asked for by name, and the one green in the app. */
  online: string;
  /** Behind a blur that is too light on its own to carry text. */
  scrim: string;
  /** The wash every bar sits on, over whatever material the platform gives it. */
  film: string;
  /**
   * The same tone as a bar, opaque.
   *
   * For the header, which spans the whole width and is pinned to the top edge.
   * Glass there gained nothing and cost a hairline: the blur has no more page
   * to sample at the boundary, so the film sat on its own along the bottom and
   * drew a pale line under the bar. This is the colour that material settles to
   * over the page, without the edge.
   */
  chrome: string;
  /** Over a photograph, where nothing from the palette has enough contrast. */
  overlay: string;
  /** Behind a sheet, dimming everything the sheet is not. */
  backdrop: string;
  /** The neutral letterbox behind full-screen photos and videos. */
  viewer: string;
  /** Android's ripple, which has to invert with the surface under it. */
  ripple: string;
}

export const DARK: Palette = {
  bg: '#0d1418',
  surface: '#141e24',
  raised: '#1b272e',
  pressed: '#22323b',
  border: '#24333c',
  text: '#e8eff2',
  muted: '#93a6b1',
  faint: '#5f7480',
  primary: '#3fc9ff',
  secondary: '#7cdbff',
  // `primary` is far too light to carry white text.
  onPrimary: '#04202e',
  danger: '#f43f5e',
  online: '#22c55e',
  scrim: 'rgba(13, 20, 24, 0.55)',
  /*
   * It was a pale lift at 0.16, tuned against an Android build that had no blur
   * at all and looked like a flat slab. On iOS, with photographs running under
   * the bar, that same film left the title unreadable — a bar you can see a dog
   * through is not a bar.
   */
  film: 'rgba(13, 20, 24, 0.62)',
  chrome: '#141e24',
  overlay: 'rgba(0, 0, 0, 0.45)',
  backdrop: 'rgba(0, 0, 0, 0.62)',
  viewer: '#000000',
  ripple: 'rgba(232, 239, 242, 0.11)',
};

export const LIGHT: Palette = {
  /*
   * The page is a definite grey, not an off-white.
   *
   * At #f7f9fa the background, the cards and the bars were three shades of the
   * same white and the screen read as one flat sheet with text floating on it.
   * A card only looks raised if there is something under it to be raised from.
   */
  bg: '#e9eef1',
  surface: '#ffffff',
  raised: '#ffffff',
  pressed: '#dbe3e8',
  border: '#d3dde2',
  text: '#16242c',
  muted: '#5f727d',
  faint: '#8b9aa3',
  // Darkened from the dark sheet's Sky, exactly as the web client darkens it:
  // the same cyan that reads well on near-black is unreadable on white.
  primary: '#0284c7',
  secondary: '#38bdf8',
  onPrimary: '#ffffff',
  danger: '#e11d48',
  // A step darker, for the same reason primary is: mid-green on white is faint.
  online: '#16a34a',
  scrim: 'rgba(255, 255, 255, 0.55)',
  // Tinted rather than plain white, so a bar keeps its own body over both a
  // photograph and the page.
  film: 'rgba(248, 251, 252, 0.76)',
  chrome: '#f3f7f9',
  // Still black: this one sits on a photograph, not on a surface, and a
  // photograph is not lighter in light mode.
  overlay: 'rgba(0, 0, 0, 0.45)',
  backdrop: 'rgba(15, 30, 38, 0.35)',
  // Media letterboxing stays neutral in both appearances. A light backdrop
  // exposed bright strips around portrait video and looked like broken layout.
  viewer: '#000000',
  ripple: 'rgba(22, 36, 44, 0.09)',
};

/**
 * The live palette.
 *
 * Mutated in place rather than replaced, because every screen in the app holds
 * `import { colors }` — a new object would leave all of them pointing at the
 * old one. `applyPalette` swaps the values and the root re-renders; see
 * `useAppearance` for the other half.
 */
export const colors: Palette = { ...DARK };

export function applyPalette(next: Palette) {
  Object.assign(colors, next);
  Object.assign(ripple, { color: next.ripple });
}

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

/**
 * Android's ripple, tuned to be visible without flashing.
 *
 * A mutable object for the same reason `colors` is: it is spread into
 * `android_ripple` all over the app, and the value has to invert with the
 * surface beneath it.
 */
export const ripple = { color: DARK.ripple, borderless: false };

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
export const TAB_BAR_CLEARANCE = Platform.OS === 'ios' ? 114 : 104;

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 };

/**
 * The floating bars' own geometry.
 *
 * These lived in the hand-built tab bar, which the platform's own bar has
 * replaced. The selection bars still float at the bottom of the screen and
 * still need to know how far in from the edge to sit and how round to be, so
 * the numbers moved here rather than leaving them in a component that no
 * longer exists.
 *
 * `BAR_HEIGHT` is what the system bar takes, which cannot be measured — it
 * moves to the side on iPad and changes with the platform — so this is an
 * estimate used only to keep the server banner clear of it.
 */
export const BAR_RADIUS = 28;
export const BAR_MARGIN = 12;
export const BAR_HEIGHT = 88;
