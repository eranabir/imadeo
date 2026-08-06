import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

interface Props {
  size?: number;
}

/**
 * The Imadeo mark: a frame split between a still and a video.
 *
 * The app holds both, and a camera lens only said one of them. The gradient is
 * emerald through teal into deep cyan rather than the full spectrum, so it
 * belongs to the same design system as everything around it.
 */
export function Logo({ size = 56 }: Props) {
  return (
    <LinearGradient
      colors={['#34d399', '#14b8a6', '#0e7490']}
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
        <Rect x="13" y="16" width="38" height="32" rx="6" fill="none" stroke="#fff" strokeWidth={4} />
        <Path d="M32 16v32" stroke="#fff" strokeWidth={3.4} />
        <Path
          d="M16 44l7-7 5 5"
          fill="none"
          stroke="#38bdf8"
          strokeWidth={3.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx="22" cy="26" r="2.8" fill="#fbbf24" />
        <Path d="M38 27l8 5-8 5z" fill="#f43f5e" />
      </Svg>
    </LinearGradient>
  );
}
