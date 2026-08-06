import { Pressable, Text, View } from 'react-native';
import { colors } from '../theme';

export type Tab = 'library' | 'backup' | 'settings';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'backup', label: 'Backup' },
  { id: 'settings', label: 'Settings' },
];

/**
 * A hand-built bar rather than a navigation library.
 *
 * Three fixed destinations with no stack, no deep links and no back behaviour
 * to get right — react-navigation would be a large dependency to carry for
 * that. Worth revisiting once a screen needs to push another on top of itself.
 */
export function Tabs({ active, onChange }: Props) {
  return (
    <View
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.bg,
        paddingBottom: 22,
        paddingTop: 10,
      }}
    >
      {TABS.map((tab) => {
        const on = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 6 }}
          >
            {/* The dot carries the state as well as the colour, so the active
                tab is not distinguished by hue alone. */}
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                marginBottom: 6,
                backgroundColor: on ? colors.accent : 'transparent',
              }}
            />
            <Text
              style={{
                color: on ? colors.accent : colors.muted,
                fontSize: 13,
                fontWeight: on ? '600' : '500',
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
