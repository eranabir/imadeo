import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'library'
  | 'browse'
  | 'folder'
  | 'album'
  | 'search'
  | 'people'
  | 'person'
  | 'pet'
  | 'backup'
  | 'settings'
  | 'back'
  | 'forward'
  | 'close'
  | 'play'
  | 'sparkle'
  | 'photo'
  | 'shared'
  | 'heart'
  | 'heart-filled'
  | 'trash'
  | 'move'
  | 'plus'
  | 'check'
  | 'edit'
  | 'phone'
  | 'done'
  | 'cloud-done';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  /** Heavier strokes for the selected tab, without changing the drawing. */
  strong?: boolean;
}

/**
 * One drawn icon set rather than a font or a native symbol library.
 *
 * `expo-symbols` would give real SF Symbols, but only on iOS — Android and web
 * fall back to whatever is passed as `fallback`, which means drawing the set
 * twice and accepting that the two never quite match. These are paths on a
 * 24-unit grid, so a tab bar looks the same on every platform the app runs on.
 *
 * Everything is stroked at a single weight and rounded at the ends, so the set
 * reads as one family at the 22–26px the app actually uses.
 */
export function Icon({ name, size = 24, color = '#e8eff2', strong = false }: Props) {
  const width = strong ? 2.1 : 1.7;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shapes(name, color)}
      </G>
    </Svg>
  );
}

/** lucide's `Heart` outline, shared by the hollow and solid forms. */
const HEART =
  'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z';

function shapes(name: IconName, color: string) {
  switch (name) {
    // lucide's `Images`: a sheet showing behind the front one, which is what
    // separates "all my photos" from the single-frame photo icon below.
    case 'library':
      return (
        <>
          <Path d="M8 3h10a3 3 0 0 1 3 3v10" />
          <Rect x="3" y="6.5" width="14.5" height="14.5" rx="3" />
          <Circle cx="8.2" cy="11.4" r="1.4" />
          <Path d="M3.4 18.4l3.9-3.7 2.6 2.5 2.8-2.6 4.4 4.2" />
        </>
      );

    case 'photo':
      return (
        <>
          <Rect x="3" y="4.5" width="18" height="15" rx="3" />
          <Circle cx="8.4" cy="9.6" r="1.5" />
          <Path d="M3.4 16.8l4.4-4.2 2.9 2.8 3.1-2.9 4.8 4.6" />
        </>
      );

    case 'folder':
      return (
        <Path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.1a2 2 0 0 1 1.6.8l1 1.4a2 2 0 0 0 1.6.8h5.7A2.5 2.5 0 0 1 21 10.5v6A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" />
      );

    // lucide's `FolderTree`: a folder with the branch that leads to it, which
    // is what separates the section from one folder inside it.
    // Shifted half a unit left of where it was: spanning 3 to 22 put its centre
    // at 12.5, so it hung right of every other glyph in the bar.
    case 'browse':
      return (
        <>
          <Path d="M11.5 4.5a1.5 1.5 0 0 1 1.5-1.5h2.2a1 1 0 0 1 .8.4l.5.7a1 1 0 0 0 .8.4h2.2A1.5 1.5 0 0 1 21 6v2.5A1.5 1.5 0 0 1 19.5 10h-7A1.5 1.5 0 0 1 11.5 8.5Z" />
          <Path d="M11.5 15.5a1.5 1.5 0 0 1 1.5-1.5h2.2a1 1 0 0 1 .8.4l.5.7a1 1 0 0 0 .8.4h2.2A1.5 1.5 0 0 1 21 17v2.5a1.5 1.5 0 0 1-1.5 1.5h-7a1.5 1.5 0 0 1-1.5-1.5Z" />
          <Path d="M3 3v13.5a1.5 1.5 0 0 0 1.5 1.5h7" />
          <Path d="M3 6.5h8.5" />
        </>
      );

    // lucide's `LayoutGrid`, which is what the web client marks Albums with.
    case 'album':
      return (
        <>
          <Rect x="3" y="3" width="7.5" height="7.5" rx="1.8" />
          <Rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8" />
          <Rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8" />
          <Rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8" />
        </>
      );

    case 'search':
      return (
        <>
          <Circle cx="10.8" cy="10.8" r="6.8" />
          <Path d="M20.5 20.5l-4.9-4.9" />
        </>
      );

    /**
     * lucide's `ScanFace`, and for the reason the web client gives: the section
     * is about recognition, so a group-of-people glyph would quietly imply pets
     * are a lesser guest in it.
     */
    case 'people':
      return (
        <>
          <Path d="M3 7.5V6a3 3 0 0 1 3-3h1.5" />
          <Path d="M16.5 3H18a3 3 0 0 1 3 3v1.5" />
          <Path d="M21 16.5V18a3 3 0 0 1-3 3h-1.5" />
          <Path d="M7.5 21H6a3 3 0 0 1-3-3v-1.5" />
          <Path d="M9 9h.01" />
          <Path d="M15 9h.01" />
          <Path d="M8.8 15a4 4 0 0 0 6.4 0" />
        </>
      );

    // lucide's `UserRound`.
    case 'person':
      return (
        <>
          <Circle cx="12" cy="8" r="4.2" />
          <Path d="M4.6 20.5a7.6 7.6 0 0 1 14.8 0" />
        </>
      );

    // lucide's `PawPrint`: four toes and a pad. Pets sit beside people, so it
    // has to read at the same size as the person icon and not as a flower.
    case 'pet':
      return (
        <>
          <Ellipse cx="5.6" cy="12.4" rx="1.9" ry="2.3" />
          <Ellipse cx="9.6" cy="7.2" rx="1.9" ry="2.4" />
          <Ellipse cx="14.4" cy="7.2" rx="1.9" ry="2.4" />
          <Ellipse cx="18.4" cy="12.4" rx="1.9" ry="2.3" />
          <Path d="M12 13.2c1.4 0 2.5.8 3.3 1.7.7.9 1.6 1.6 2.4 2.3.7.7 1.1 1.5 1.1 2.4 0 1.6-1.3 2.9-2.9 2.9-1.3 0-2.2-.7-3.9-.7s-2.6.7-3.9.7A2.9 2.9 0 0 1 5.2 19.6c0-.9.4-1.7 1.1-2.4.8-.7 1.7-1.4 2.4-2.3.8-.9 1.9-1.7 3.3-1.7Z" />
        </>
      );

    case 'backup':
      return (
        <>
          <Path d="M17.2 18.6a4.3 4.3 0 0 0 .3-8.5 6 6 0 0 0-11.4-.6 4.4 4.4 0 0 0 .7 8.7" />
          <Path d="M12 20.5V10.8" />
          <Path d="M8.6 14L12 10.5l3.4 3.5" />
        </>
      );

    // The gear the web client uses, as an eight-tooth ring rather than lucide's
    // twelve-notch path — at 22px the extra notches close up into a blur.
    case 'settings':
      return (
        <>
          <Path d="M10.56 2.91L13.44 2.91L13.29 5.22L15.88 6.29L17.41 4.56L19.44 6.59L17.71 8.12L18.78 10.71L21.09 10.56L21.09 13.44L18.78 13.29L17.71 15.88L19.44 17.41L17.41 19.44L15.88 17.71L13.29 18.78L13.44 21.09L10.56 21.09L10.71 18.78L8.12 17.71L6.59 19.44L4.56 17.41L6.29 15.88L5.22 13.29L2.91 13.44L2.91 10.56L5.22 10.71L6.29 8.12L4.56 6.59L6.59 4.56L8.12 6.29L10.71 5.22Z" />
          <Circle cx="12" cy="12" r="3.1" />
        </>
      );

    case 'back':
      return <Path d="M15 4.5L7.5 12l7.5 7.5" />;

    case 'forward':
      return <Path d="M9 4.5l7.5 7.5L9 19.5" />;

    case 'close':
      return (
        <>
          <Path d="M6.2 6.2l11.6 11.6" />
          <Path d="M17.8 6.2L6.2 17.8" />
        </>
      );

    // Solid, because a hollow triangle disappears over a photograph.
    case 'play':
      return <Path d="M8 5.2l11.5 6.8L8 18.8Z" fill={color} />;

    // Search that looks at the pictures rather than their names.
    case 'sparkle':
      return (
        <>
          <Path d="M12.5 3.2l1.85 4.75L19 9.8l-4.65 1.85L12.5 16.4l-1.85-4.75L6 9.8l4.65-1.85Z" />
          <Path d="M6 15.5l.85 2.15L9 18.5l-2.15.85L6 21.5l-.85-2.15L3 18.5l2.15-.85Z" />
        </>
      );

    case 'shared':
      return (
        <>
          <Circle cx="17.5" cy="6" r="2.6" />
          <Circle cx="6.5" cy="12" r="2.6" />
          <Circle cx="17.5" cy="18" r="2.6" />
          <Path d="M8.8 10.8l6.4-3.5" />
          <Path d="M8.8 13.2l6.4 3.5" />
        </>
      );

    /**
     * lucide's `Heart`, hollow and solid off the one outline.
     *
     * The pair is the whole vocabulary: hollow means "not a favourite, tap to
     * make it one", solid means "already one". A slashed heart was standing in
     * for hollow, and that is a different word entirely — a struck-through
     * control says the action is unavailable, not that it is untaken.
     */
    case 'heart':
      return <Path d={HEART} />;

    case 'heart-filled':
      return <Path d={HEART} fill={color} />;

    case 'trash':
      return (
        <>
          <Path d="M4 6.6h16" />
          <Path d="M9.2 6.6V4.8a1.3 1.3 0 0 1 1.3-1.3h3a1.3 1.3 0 0 1 1.3 1.3v1.8" />
          <Path d="M6.2 6.6l.9 12.1a2 2 0 0 0 2 1.8h5.8a2 2 0 0 0 2-1.8l.9-12.1" />
          <Path d="M10.3 10.4v6.2" />
          <Path d="M13.7 10.4v6.2" />
        </>
      );

    // A folder with something going into it, which is what "move to" means.
    case 'move':
      return (
        <>
          <Path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.1a2 2 0 0 1 1.6.8l1 1.4a2 2 0 0 0 1.6.8h5.7A2.5 2.5 0 0 1 21 10.5v6A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" />
          <Path d="M12 16.2v-6" />
          <Path d="M9.4 12.6L12 10l2.6 2.6" />
        </>
      );

    case 'plus':
      return (
        <>
          <Path d="M12 5v14" />
          <Path d="M5 12h14" />
        </>
      );

    case 'check':
      return <Path d="M4.8 12.6l4.6 4.6L19.2 7.4" />;

    case 'edit':
      return (
        <>
          <Path d="M16.4 4.6a2.1 2.1 0 0 1 3 3L9 18l-4 1 1-4Z" />
          <Path d="M14.6 6.4l3 3" />
        </>
      );

    /**
     * Wider and taller than a phone strictly is.
     *
     * Drawn to 12×19 it covered 228 square units against the gear's 331, and in
     * a row of five it read as the small, thin one rather than as a peer. A tall
     * narrow glyph has to be given more of the box than its outline suggests to
     * carry the same weight beside a round one.
     */
    case 'phone':
      return (
        <>
          <Rect x="5" y="2" width="14" height="20" rx="3.6" />
          <Path d="M9.9 5.1h4.2" />
          <Circle cx="12" cy="18.6" r="1.05" fill={color} />
        </>
      );

    case 'done':
      return (
        <>
          <Circle cx="12" cy="12" r="8.6" />
          <Path d="M8.3 12.2l2.6 2.6 4.8-5" />
        </>
      );

    /**
     * On the server, said in the corner of a thumbnail.
     *
     * The cloud sits high and the tick low inside it, because at the 13px this
     * is actually drawn a centred tick closes up against the cloud's own
     * underside and the whole thing reads as a smudge.
     */
    case 'cloud-done':
      return (
        <>
          <Path d="M6.9 17.3a3.9 3.9 0 0 1-.6-7.7 5.4 5.4 0 0 1 10.3-.5 3.8 3.8 0 0 1 .8 7.5" />
          <Path d="M9.2 14.4l2.1 2.1 4-4.2" />
        </>
      );
  }
}
