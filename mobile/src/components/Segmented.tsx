import { Text, View } from 'react-native';
import { colors, radius, shadow } from '../theme';
import { Icon, type IconName } from './Icon';
import { Touchable } from './ui';

export interface Segment<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
}

interface Props<T extends string> {
  segments: Segment<T>[];
  active: T;
  onChange: (id: T) => void;
}

/**
 * Two or three ways of looking at the same screen.
 *
 * Drawn on a track rather than as free-floating pills so the unselected options
 * still read as choices — a row of plain words does not look pressable, and on
 * these screens the second option is the one people are usually after.
 */
export function Segmented<T extends string>({ segments, active, onChange }: Props<T>) {
  // Four across a phone leaves about 80pt a column, which "Content" plus an
  // icon does not fit at the three-segment size.
  const tight = segments.length > 3;

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderRadius: radius.pill,
        padding: 3,
        gap: 3,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {segments.map((segment) => {
        const on = segment.id === active;
        return (
          <Touchable
            key={segment.id}
            onPress={() => onChange(segment.id)}
            // Not a tab: the bottom bar is the app's tab set, and two controls
            // both announcing "People, tab" is genuinely ambiguous to a screen
            // reader. This picks one of several views of one screen, which is
            // what a radio group is.
            role="radio"
            selected={on}
            label={segment.label}
            radius={radius.pill}
            style={[{ flex: 1 }, on ? shadow(1) : null]}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: tight ? 4 : 6,
                paddingVertical: 9,
                paddingHorizontal: 2,
                borderRadius: radius.pill,
                backgroundColor: on ? colors.accent : 'transparent',
              }}
            >
              {segment.icon && (
                <Icon
                  name={segment.icon}
                  size={tight ? 13 : 15}
                  color={on ? colors.onAccent : colors.muted}
                />
              )}
              <Text
                numberOfLines={1}
                style={{
                  color: on ? colors.onAccent : colors.muted,
                  fontSize: tight ? 12.5 : 14,
                  fontWeight: on ? '700' : '600',
                }}
              >
                {segment.label}
              </Text>
            </View>
          </Touchable>
        );
      })}
    </View>
  );
}
