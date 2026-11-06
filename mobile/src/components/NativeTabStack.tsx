import { useTheme } from 'expo-router/react-navigation';
import { createContext } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { colors } from '../theme';

export const NativeHeaderContext = createContext(false);
/** Each tab owns a navigation controller so UIKit can combine its toolbar with the tab rail. */
export function NativeTabStack() {
  const theme = useTheme();
  return <NativeHeaderContext.Provider value={Platform.OS === 'ios'}>
    <Stack screenOptions={{ headerShown: false, headerShadowVisible: false,
      headerTintColor: colors.primary, contentStyle: { backgroundColor: theme.colors.background } }} />
  </NativeHeaderContext.Provider>;
}
