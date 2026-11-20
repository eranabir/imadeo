import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  Animated,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, motion, radius, shadow } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** How far off the top counts as having scrolled. */
const AWAY = 12;

/**
 * Whether the list has been scrolled off the top, and the handler that says so.
 *
 * Not "is it moving". Both the date and the handle used to come and go with the
 * movement, which meant they blinked out every time a finger paused mid-flick —
 * and the date is the answer to "where am I", which does not stop being worth
 * knowing the moment the list is still. So they appear once the top of the list
 * has been left behind and stay for as long as it has.
 *
 * At the very top there is nothing to say: the newest photographs are where the
 * list opens, and neither a date nor a rail earns its place over them.
 */
export function useScrolledAway(): [boolean, (offset: number) => void] {
  const [away, setAway] = useState(false);
  const previous = useRef(false);

  const mark = useCallback((offset: number) => {
    const now = offset > AWAY;
    if (now === previous.current) return;
    previous.current = now;
    setAway(now);
  }, []);

  return [away, mark];
}

/**
 * The day sitting under the bar right now.
 *
 * Viewability cannot answer this. A row counts as visible anywhere in the
 * viewport, so a day whose photographs are halfway down the screen reports
 * itself just as loudly as the one at the top, and the threshold that decides
 * "visible" means a row leaving the top stops counting while a third of it is
 * still on screen — the label changed early on the way down, late on the way
 * up, and never at the moment a day actually reached the bar.
 *
 * Nor can the offset be turned into a day by arithmetic. Every tile is a third
 * of the screen wide and therefore a third of it tall, which is not a whole
 * number of points on any phone ever made; a row measures 147.67 here and comes
 * back from the layout as 148. Multiply that by the thousand rows a real
 * library has and the answer is out by several days — which is exactly what a
 * date over the wrong photographs looks like.
 *
 * So the rows are asked where they are rather than told. Each one reports its
 * own place in the list as it is laid out, and the day is whichever row's top
 * has last passed under the bar. Only the rows on screen are on the books, so
 * the search is over a couple of dozen entries and no arithmetic is trusted
 * further than a single row.
 */
export function useDayAtTop<T extends { id: string }>(
  sections: { title: string; data: T[][] }[],
  /** Room the floating header takes: the line the date is read at. */
  topInset: number,
): [string | undefined, (offset: number) => void, ComponentType<CellProps<T[]>>] {
  const [day, setDay] = useState<string | undefined>(undefined);

  /*
   * Where each row on screen sits, by the id of the first photograph in it.
   *
   * A ref rather than state: this is written on every layout and read on every
   * scroll frame, and neither wants a render.
   */
  const placed = useRef(new Map<string, number>()).current;

  const dayOfRow = useMemo(() => {
    const rows = new Map<string, string>();
    for (const section of sections) {
      for (const row of section.data) if (row[0]) rows.set(row[0].id, section.title);
    }
    return rows;
  }, [sections]);

  /**
   * The wrapper the list puts around every cell, which is the one view whose
   * position is measured against the scrolling content itself.
   *
   * The list's own `onLayout` has to be called too — this is standing in for
   * its wrapper, not adding one, and virtualisation is driven by it.
   */
  const Cell = useMemo(
    () =>
      function Cell({ item, onLayout, children, ...rest }: CellProps<T[]>) {
        const id = Array.isArray(item) && item[0]?.id ? item[0].id : null;

        // Off the books the moment the row is recycled, so the search stays
        // over what is on screen rather than everything ever scrolled past.
        useEffect(() => () => void (id && placed.delete(id)), [id]);

        return (
          <View
            {...rest}
            onLayout={(event) => {
              onLayout?.(event);
              if (id) placed.set(id, event.nativeEvent.layout.y);
            }}
          >
            {children}
          </View>
        );
      },
    [placed],
  );

  const mark = useCallback(
    (offset: number) => {
      const line = offset + topInset;

      // The lowest row that has already reached the bar; failing that — at the
      // very top of the list — the first row there is.
      let last = -Infinity;
      let first = Infinity;
      let atLine: string | undefined;
      let atTop: string | undefined;

      for (const [id, y] of placed) {
        if (y <= line && y > last) {
          last = y;
          atLine = id;
        }
        if (y < first) {
          first = y;
          atTop = id;
        }
      }

      const title = dayOfRow.get(atLine ?? atTop ?? '');
      if (title) setDay((was) => (was === title ? was : title));
    },
    [placed, dayOfRow, topInset],
  );

  return [day, mark, Cell];
}

/** What a `VirtualizedList` hands whatever it wraps its cells in. */
export interface CellProps<T> {
  cellKey: string;
  index: number;
  item: T;
  style: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}

/**
 * The date of whatever is at the top of the screen, under the bar.
 *
 * Google Photos does this and it is the right trade for a dense grid: a heading
 * above every day turns a wall of photographs into a list of dates, while one
 * label that keeps up with the scroll answers the same question — when am I? —
 * and costs no room in the grid at all.
 */
export function DateLabel({ children, visible }: { children: ReactNode; visible: boolean }) {
  const showing = visible && !!children;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(fade, {
      toValue: showing ? 1 : 0,
      duration: showing ? motion.quick : motion.exit,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [showing, fade]);

  if (!children) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        opacity: fade,
        position: 'absolute',
        left: 16,
        borderRadius: radius.pill,
        paddingHorizontal: 13,
        paddingVertical: 6,
        backgroundColor: colors.raised,
        ...shadow(2),
      }}
    >
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{children}</Text>
    </Animated.View>
  );
}
