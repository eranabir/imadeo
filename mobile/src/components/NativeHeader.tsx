import { HeaderHeightContext, useTheme } from 'expo-router/react-navigation';
import { Children, isValidElement, useContext, type ComponentType, type ReactNode } from 'react';
import { Stack, useRouter, type StackToolbarButtonProps } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import type { HeaderConfig } from './Header';
import type { IconName } from './Icon';
import { isRegularIPhone } from '../lib/deviceLayout';
import { regularIPhoneHeaderHeight } from '../lib/layout';

export const NATIVE_HEADING_HEIGHT = 56;

type Action = { label: string; icon?: IconName; onPress: () => void };
const symbols: Partial<Record<IconName, StackToolbarButtonProps['icon']>> = {
  backup: 'icloud.and.arrow.up', plus: 'plus', list: 'list.bullet', grid: 'square.grid.2x2',
  shared: 'square.and.arrow.up', lock: 'lock', unlock: 'lock.open', close: 'xmark',
  pause: 'pause', play: 'play', check: 'checkmark', done: 'checkmark',
  edit: 'pencil', trash: 'trash', move: 'folder', download: 'square.and.arrow.down',
};
function items(node: ReactNode, actionType: ComponentType<any>): Action[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) return [];
    if (child.type === actionType) {
      const action = child.props as Action;
      return [action];
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
  if (account) actions.push({ label: 'Account', onPress: () => router.push('/account') });
  // The call/status cluster and tabs share this vertical column. Reserve just
  // one toolbar slot so UIKit cannot push our actions into the tab platter.
  const grouped = insets.right > 0 && actions.length > 1;
  const ActionItem = grouped ? Stack.Toolbar.MenuAction : Stack.Toolbar.Button;
  const actionItems = actions.map((action, index) => <ActionItem key={`${action.label}-${index}`}
    icon={action.label === 'Account' && !action.icon ? 'person.crop.circle'
      : action.icon ? symbols[action.icon] ?? 'ellipsis' : 'ellipsis'}
    tintColor={colors.primary} onPress={action.onPress}>{action.label}</ActionItem>);
  const headingHeight = isRegularIPhone
    ? regularIPhoneHeaderHeight(headerHeight, insets.top) - insets.top : NATIVE_HEADING_HEIGHT;
  const actionWidth = actions.length * 44 + 24;
  return <>
    <Stack.Screen options={{ title: '', headerShown: true, headerBackVisible: false,
      headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerBlurEffect: 'none', headerTintColor: colors.primary, headerTitleStyle: { color: theme.colors.text }, headerShadowVisible: false }} />
    <Stack.Toolbar placement="left">
      {onBack && <Stack.Toolbar.Button tintColor={colors.primary} icon="chevron.backward" onPress={onBack}>Back</Stack.Toolbar.Button>}
    </Stack.Toolbar>
    <Stack.Toolbar placement="right">
      {grouped ? <Stack.Toolbar.Menu icon="ellipsis" tintColor={colors.primary} accessibilityLabel="Actions">
        <Stack.Toolbar.Label>Actions</Stack.Toolbar.Label>
        {actionItems}
      </Stack.Toolbar.Menu> : actionItems}
    </Stack.Toolbar>
    <View style={{ position: 'absolute', top: 0, paddingTop: isRegularIPhone ? insets.top : headerHeight, left: insets.left,
      right: insets.right, zIndex: 10, backgroundColor: theme.colors.background }}>
      <View style={{ height: headingHeight, paddingHorizontal: 16, justifyContent: 'center',
        ...(isRegularIPhone ? { paddingLeft: onBack ? 64 : 16, paddingRight: Math.max(16, actionWidth) } : {}) }}>
        <Text accessibilityRole="header" numberOfLines={1}
          style={{ color: theme.colors.text, fontSize: isRegularIPhone ? 22 : 24,
            lineHeight: isRegularIPhone ? 26 : 30, fontWeight: '700' }}>{title}</Text>
        {subtitle && <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13,
          lineHeight: isRegularIPhone ? 16 : 18, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      {children}
    </View>
  </>;
}
