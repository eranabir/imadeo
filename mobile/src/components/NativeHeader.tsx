import { HeaderHeightContext, useTheme } from 'expo-router/react-navigation';
import { Children, isValidElement, useContext, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { Stack, useRouter, type StackToolbarButtonProps } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import type { HeaderConfig } from './Header';
import type { IconName } from './Icon';

type Action = { label: string; icon?: IconName; onPress: () => void };
const symbols: Partial<Record<IconName, StackToolbarButtonProps['icon']>> = {
  backup: 'icloud.and.arrow.up', plus: 'plus', list: 'list.bullet', grid: 'square.grid.2x2',
  shared: 'square.and.arrow.up', lock: 'lock', unlock: 'lock.open', close: 'xmark',
  pause: 'pause', play: 'play', check: 'checkmark', done: 'checkmark',
  edit: 'pencil', trash: 'trash', move: 'folder', download: 'square.and.arrow.down',
};
function items(node: ReactNode, actionType: ComponentType<any>): ReactElement[] {
  return Children.toArray(node).flatMap((child, index) => {
    if (!isValidElement(child)) return [];
    if (child.type === actionType) {
      const action = child.props as Action;
      return [<Stack.Toolbar.Button key={`${action.label}-${index}`}
        icon={action.icon ? symbols[action.icon] ?? 'ellipsis' : 'ellipsis'} tintColor={colors.primary}
        onPress={action.onPress}>{action.label}</Stack.Toolbar.Button>];
    }
    return items((child.props as { children?: ReactNode }).children, actionType);
  });
}
export function NativeHeader({ title, subtitle, onBack, action, account, children, actionType }: HeaderConfig & {
  account?: ReactNode; children?: ReactNode; actionType: ComponentType<any>;
}) {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const actions = items(action, actionType);
  return <>
    <Stack.Screen options={{ title, headerShown: true, headerBackVisible: false,
      headerTransparent: true, headerStyle: { backgroundColor: theme.colors.background }, headerBlurEffect: 'none', headerTintColor: colors.primary, headerTitleStyle: { color: theme.colors.text }, headerShadowVisible: false }} />
    <Stack.Toolbar placement="left">
      {onBack && <Stack.Toolbar.Button tintColor={colors.primary} icon="chevron.backward" onPress={onBack}>Back</Stack.Toolbar.Button>}
    </Stack.Toolbar>
    <Stack.Toolbar placement="right">
      {actions}
      {account && <Stack.Toolbar.Button tintColor={colors.primary} icon="person.crop.circle" onPress={() => router.push('/account')}>Account</Stack.Toolbar.Button>}
    </Stack.Toolbar>
    {(subtitle || children) && <View style={{ position: 'absolute', top: headerHeight, left: insets.left,
      right: insets.right, zIndex: 10, backgroundColor: theme.colors.background }}>
      {subtitle && <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13,
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>{subtitle}</Text>}
      {children}
    </View>}
  </>;
}
