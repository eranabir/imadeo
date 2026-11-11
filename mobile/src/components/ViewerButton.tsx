import { createContext, useContext, type ReactNode } from 'react';
import { requireNativeViewManager } from 'expo-modules-core';
import { Platform, View, type ViewStyle, type ViewProps } from 'react-native';
import { DARK, radius } from '../theme';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';
import { Touchable } from './ui';

const NativeButton = Platform.OS === 'ios'
  ? requireNativeViewManager<ViewProps & {
    symbol: string; symbolSize: number; label: string; disabled: boolean; tint: string; onActivate: () => void;
  }>('ImadeoViewerButton') : null;

const symbols: Partial<Record<IconName, string>> = {
  'fullscreen-exit': 'arrow.down.right.and.arrow.up.left',
  play: 'play.fill', pause: 'pause.fill', fullscreen: 'arrow.up.left.and.arrow.down.right',
  close: 'xmark', back: 'chevron.left', rotate: 'rotate.right', heart: 'heart',
  'heart-filled': 'heart.fill', lock: 'lock', unlock: 'lock.open', shared: 'square.and.arrow.up',
  download: 'square.and.arrow.down', trash: 'trash', info: 'info.circle',
  backup: 'icloud.and.arrow.up', 'cloud-done': 'checkmark.icloud',
};

const Grouped = createContext<{ symbolSize: number } | null>(null);

/** All controls share the same material and capsule as the rest of the app. */
export function ViewerActionGroup({ children, horizontal = false, style }: {
  children: ReactNode; horizontal?: boolean; style?: ViewStyle;
}) {
  return <Glass interactive radius={radius.pill} style={{ width: horizontal ? undefined : 48, flexShrink: 0,
      flexDirection: horizontal ? 'row' : 'column', ...style }}>
    <Grouped.Provider value={{ symbolSize: 18 }}>{children}</Grouped.Provider>
  </Glass>;
}

export function ViewerAction({ icon, label, tint = DARK.text, onPress, disabled = false }: {
  icon: IconName; label: string; tint?: string; onPress: () => void; disabled?: boolean;
}) {
  const grouped = useContext(Grouped);
  const symbolSize = grouped?.symbolSize ?? 18;
  const button = NativeButton ? <NativeButton symbol={symbols[icon] ?? 'ellipsis'} symbolSize={symbolSize} label={label}
    tint={tint} disabled={disabled} onActivate={onPress} style={{ width: 48, height: 48 }} /> :
    <Touchable onPress={onPress} disabled={disabled} radius={radius.pill} label={label}
      style={{ width: 48, height: 48 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={symbolSize} color={tint} />
      </View>
    </Touchable>;
  return grouped ? button : <ViewerActionGroup>{button}</ViewerActionGroup>;
}
