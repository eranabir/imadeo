import { NativeTabs } from 'expo-router/unstable-native-tabs';

/**
 * The five destinations, drawn by the operating system.
 *
 * `UITabBarController` on iOS — so iOS 26's liquid glass, its scroll
 * behaviour and its hold-and-slide gesture arrive for free rather than being
 * imitated — and a Material `BottomNavigationView` on Android. This replaces a
 * hand-built bar that had spent a long time approximating both.
 *
 * Android caps a bottom bar at five destinations. There are exactly five here,
 * so a sixth tab is not a small change.
 *
 * Icons are named twice on purpose: `sf` is an SF Symbol, `md` a Material
 * symbol. Neither platform is asked to render the other's set, which is what
 * makes the bar look native rather than ported.
 */
export default function TabsLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="iphone" md="smartphone" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="browse">
        <NativeTabs.Trigger.Icon sf="photo.stack" md="photo_library" />
        <NativeTabs.Trigger.Label>Browse</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="people">
        <NativeTabs.Trigger.Icon sf="person.2" md="people" />
        <NativeTabs.Trigger.Label>People &amp; Pets</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
