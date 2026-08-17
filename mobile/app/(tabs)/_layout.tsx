import { Platform } from 'react-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useSelectionBar } from '../../src/selection';
import { colors, wash } from '../../src/theme';

/**
 * Native UITabBarController on iOS and BottomNavigationView on Android.
 *
 * iOS 26 owns the floating platter, material, controls and selection lens.
 * Do not pass appearance overrides there: UIKit derives Liquid Glass from the
 * screen content and the navigation ThemeProvider.
 */
export default function TabsLayout() {
  const { active } = useSelectionBar();

  return (
    <NativeTabs
      hidden={active}
      labelVisibilityMode="labeled"
      minimizeBehavior="never"
      tintColor={Platform.OS === 'ios' ? colors.primary : undefined}
      backgroundColor={Platform.OS === 'android' ? colors.surface : undefined}
      indicatorColor={Platform.OS === 'android' ? wash(colors.primary) : undefined}
      disableTransparentOnScrollEdge={Platform.OS === 'ios'}
    >
      <NativeTabs.Trigger
        name="index"
        contentStyle={{ backgroundColor: colors.bg }}
        testID="library-tab"
      >
        <NativeTabs.Trigger.Icon sf="iphone" md="smartphone" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="browse"
        contentStyle={{ backgroundColor: colors.bg }}
        testID="browse-tab"
      >
        <NativeTabs.Trigger.Icon sf="photo.stack" md="photo_library" />
        <NativeTabs.Trigger.Label>Browse</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="search"
        contentStyle={{ backgroundColor: colors.bg }}
        testID="search-tab"
      >
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="people-and-pets"
        contentStyle={{ backgroundColor: colors.bg }}
        testID="people-and-pets-tab"
      >
        <NativeTabs.Trigger.Icon
          src={require('../../assets/people-and-pets-scan.png')}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>People &amp; Pets</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger
        name="settings"
        contentStyle={{ backgroundColor: colors.bg }}
        testID="settings-tab"
      >
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
