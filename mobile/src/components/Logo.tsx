import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { BRAND } from '../theme';

interface Props {
  size?: number;
}


/**
 * The Imadeo mark: a photo and a video, overlapping like prints on a table.
 *
 * Two frames rather than one split down the middle. A single divided frame only
 * held together at large sizes — at 26px in a header the detail inside it
 * disappeared. Two offset shapes keep a silhouette that still reads small.
 *
 * The amber frame carries a sun over a horizon; the sky-blue one in front
 * carries a play triangle. Both colours are from the app's own palette, on the
 * sky-blue tile the primary is drawn from.
 */
export function Logo({ size = 56 }: Props) {
  return (
    <LinearGradient
      colors={[...BRAND]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.29,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 64 64">
        {/* Behind: the photo. */}
        <Rect x="12" y="14" width="26" height="24" rx="5" fill="#fbbf24" />
        <Circle cx="19" cy="21" r="2.6" fill="#fff" />
        <Path d="M12 34l6-6 4 4 4-4 12 10H12z" fill="#f97316" />

        {/* In front: the video. Its stroke is the tile colour, so the two frames
            stay separate without an outline that would vanish when scaled. */}
        <Rect
          x="26"
          y="27"
          width="26"
          height="24"
          rx="5"
          fill="#3fc9ff"
          stroke="#0369a1"
          strokeWidth={3}
        />
        <Path d="M35 33.5l9 5.5-9 5.5z" fill="#fff" />
      </Svg>
    </LinearGradient>
  );
}

/**
 * Mark plus the app's name, with colour travelling through the letters.
 *
 * Each letter runs the same loop offset a little further along, so the hue
 * arrives at one letter after another and reads as a wave crossing the word.
 * Animating a single colour for the whole word made it change all at once,
 * which looked like a status light rather than an effect.
 *
 * Built from per-letter interpolation rather than a masked gradient: masking
 * needs a native view that does not composite on web, and this has to look the
 * same everywhere.
 */
const WORD = 'Imadeo'.split('');
// The tile's own range — emerald through teal and cyan into sky — rather than
// a full spectrum. Violet, amber and rose belonged to the sidebar icons, not
// to the brand, and pulled the wordmark away from everything around it.
const HUES = ['#e8eff2', '#7cdbff', '#3fc9ff', '#0ea5e9', '#3fc9ff', '#7cdbff', '#e8eff2'];

export function LogoLockup({ size = 48 }: Props) {
  const wave = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(wave, {
        toValue: 1,
        duration: 4200,
        easing: Easing.linear,
        // Colour cannot be driven natively, but one interpolation per letter at
        // this duration is far below anything the JS thread notices.
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [wave]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
      <Logo size={size} />
      <View style={{ flexDirection: 'row' }}>
        {WORD.map((letter, index) => {
          // Each letter starts a fraction later, which is what makes the colour
          // sweep along the word instead of landing on all of it together.
          const shift = index / (WORD.length * 1.6);
          const color = wave.interpolate({
            inputRange: HUES.map((_, i) => {
              const at = i / (HUES.length - 1) + shift;
              return at > 1 ? at - 1 : at;
            }).sort((a, b) => a - b),
            outputRange: HUES,
          });

          return (
            <Animated.Text
              key={index}
              style={{ color, fontSize: 32, fontWeight: '700', letterSpacing: -0.8 }}
            >
              {letter}
            </Animated.Text>
          );
        })}
      </View>
    </View>
  );
}
