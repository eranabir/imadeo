import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelectionBar } from '../selection';
import { colors, radius, ripple, shadow } from '../theme';
import { Glass, liquidGlass } from './Glass';
import { Icon, type IconName } from './Icon';

export type Tab = 'library' | 'browse' | 'search' | 'people' | 'settings';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'library', label: 'Library', icon: 'phone' },
  { id: 'browse', label: 'Browse', icon: 'browse' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'people', label: 'People & Pets', icon: 'people' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

/** The bar's own corner radius, and the inset that lets it read as floating. */
export const BAR_RADIUS = 28;
export const BAR_MARGIN = 12;

const ICON = 20;

/**
 * The indicator's size, fixed so its radius can be exactly half its height.
 *
 * Both earlier attempts left the radius depending on something measured — first
 * `999` clamped by the platform, then padding around an icon. A browser and
 * Android resolve those differently, so the shape verified on web was not the
 * shape that shipped. These are numbers.
 */
const PILL_HEIGHT = 30;
const PILL_WIDTH = 54;

/** Padding the indicator has to clear to line up with the icons. */
const ROW_PAD_Y = 6;
const ROW_PAD_X = 4;
const TAB_PAD_Y = 2;

/**
 * The bar's outer height, so anything floating above it can clear it.
 *
 * Worked out from the parts rather than measured, because the only thing that
 * needs it — the server banner — renders before the bar has laid out.
 */
export const BAR_HEIGHT = ROW_PAD_Y * 2 + TAB_PAD_Y * 2 + PILL_HEIGHT + 3 + 14;

/**
 * A hand-built bar rather than a navigation library.
 *
 * Five fixed destinations. Pushing a screen on top of one of them is handled by
 * the stack in `navigation.tsx`, which is small enough that react-navigation
 * would still be a large dependency to carry for what it adds.
 *
 * It floats clear of the screen edges on every platform. Pinning it to the
 * bottom made it a strip of chrome the photographs stopped at; lifting it off
 * lets the grid run under and past it, which is the point of putting glass
 * there in the first place.
 */
export function Tabs({ active, onChange }: Props) {
  const insets = useSafeAreaInsets();
  const { active: selecting } = useSelectionBar();
  const [barWidth, setBarWidth] = useState(0);

  const index = Math.max(0, TABS.findIndex((tab) => tab.id === active));

  /** Where the indicator rests over a given column, once the bar is measured. */
  const restingAt = useCallback(
    (at: number) => {
      const column = (barWidth - ROW_PAD_X * 2) / TABS.length;
      return ROW_PAD_X + column * at + (column - PILL_WIDTH) / 2;
    },
    [barWidth],
  );

  const slide = useRef(new Animated.Value(0)).current;
  /** Skips the animation the first time, so the bar does not fly in on launch. */
  const settled = useRef(false);

  useEffect(() => {
    if (barWidth === 0) return;
    const to = restingAt(index);

    if (!settled.current) {
      slide.setValue(to);
      settled.current = true;
      return;
    }

    // A spring rather than a timing curve: the indicator is a physical object
    // being moved, and a little overshoot at the end is what sells that. Kept
    // just short of bouncing — this runs on every tab press.
    Animated.spring(slide, {
      toValue: to,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [index, barWidth, restingAt, slide]);

  // While photos are picked out, the actions on them take this corner of the
  // screen. Two bars stacked there would be 140pt of chrome, and moving tabs
  // is not what the next tap is for.
  if (selecting) return null;

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        // A phone with a home indicator already reserves room below the bar;
        // one with a physical button reserves none, and the capsule would sit
        // on the very edge of the screen.
        paddingBottom: Math.max(insets.bottom, BAR_MARGIN),
        paddingHorizontal: BAR_MARGIN,
        zIndex: 20,
        // The bar floats over the grid; taps outside it belong to the photos.
        pointerEvents: 'box-none',
      }}
    >
      <Glass radius={BAR_RADIUS} interactive={liquidGlass} style={shadow(3)}>
        <View
          onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
          style={{
            flexDirection: 'row',
            paddingVertical: ROW_PAD_Y,
            paddingHorizontal: ROW_PAD_X,
            // Liquid glass draws its own edge; everything else needs one, or
            // the bar dissolves into a pale photograph behind it.
            ...(liquidGlass
              ? null
              : { borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', borderRadius: BAR_RADIUS }),
          }}
        >
          {/*
            One indicator that travels, rather than five that blink.

            It sits behind the icons as a single absolutely-placed capsule and
            slides to whichever column is selected. Fading one out while
            another faded in read as two separate things happening; moving the
            same object says the selection went from here to there.

            Held back until the bar has been measured — its resting place is a
            fraction of a width nobody knows on the first render.
          */}
          {barWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: ROW_PAD_Y + TAB_PAD_Y,
                left: 0,
                width: PILL_WIDTH,
                height: PILL_HEIGHT,
                borderRadius: PILL_HEIGHT / 2,
                backgroundColor: 'rgba(20, 184, 166, 0.22)',
                transform: [{ translateX: slide }],
              }}
            />
          )}

          {TABS.map((tab) => {
            const on = tab.id === active;
            return (
              <Pressable
                key={tab.id}
                onPress={() => onChange(tab.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={tab.label}
                /**
                 * A round, unbounded ripple.
                 *
                 * The alternative — clipping this column to a rounded rect —
                 * puts Android into a rounded clip path for the whole subtree,
                 * and the indicator inside came out with flattened ends. The
                 * indicator's shape matters more than the ripple's, so the
                 * clip goes and the ripple is bounded by radius instead.
                 */
                android_ripple={{ ...ripple, borderless: true, radius: 34 }}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 4,
                  opacity: pressed && Platform.OS !== 'android' ? 0.6 : 1,
                })}
              >
                <View
                  style={{
                    height: PILL_HEIGHT,
                    width: PILL_WIDTH,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 3,
                  }}
                >
                  <Icon
                    name={tab.icon}
                    size={ICON}
                    color={on ? colors.accent : colors.muted}
                    strong={on}
                  />
                </View>
                {/* "People & Pets" is twice the length of "Search" and has to
                    fit the same column, so the labels shrink to whatever the
                    narrowest one allows rather than that one alone ellipsing. */}
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{
                    color: on ? colors.accent : colors.muted,
                    fontSize: 10,
                    fontWeight: on ? '700' : '500',
                    textAlign: 'center',
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}
