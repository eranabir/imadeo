import { requireNativeViewManager } from 'expo-modules-core';
import { Platform, View, type ViewProps } from 'react-native';
import { DARK, radius } from '../theme';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';
import { Touchable } from './ui';

const NativeButton = Platform.OS === 'ios'
  ? requireNativeViewManager<ViewProps & {
    symbol: string; label: string; disabled: boolean; tint: string; onActivate: () => void;
  }>('ImadeoViewerButton') : null;

const symbols: Partial<Record<IconName, string>> = {
  close: 'xmark', back: 'chevron.left', rotate: 'rotate.right', heart: 'heart',
  'heart-filled': 'heart.fill', lock: 'lock', unlock: 'lock.open', shared: 'square.and.arrow.up',
  download: 'square.and.arrow.down', trash: 'trash', info: 'info.circle',
  backup: 'icloud.and.arrow.up', 'cloud-done': 'checkmark.icloud',
};

export function ViewerAction({ icon, label, tint = DARK.text, onPress, disabled = false }: {
  icon: IconName; label: string; tint?: string; onPress: () => void; disabled?: boolean;
}) {
  if (NativeButton) return <NativeButton symbol={symbols[icon] ?? 'ellipsis'} label={label}
    tint={tint} disabled={disabled} onActivate={onPress} style={{ width: 44, height: 44 }} />;
  return <Glass colorScheme="dark" radius={radius.pill}>
    <Touchable onPress={onPress} disabled={disabled} radius={radius.pill} label={label}
      style={{ width: 44, height: 44 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} color={tint} />
      </View>
    </Touchable>
  </Glass>;
}
