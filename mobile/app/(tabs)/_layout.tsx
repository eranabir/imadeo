import { Platform } from 'react-native';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useSelectionBar } from '../../src/selection';
import { colors, wash } from '../../src/theme';

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
 *
 * Search is an ordinary destination, not `role="search"`. The role is what iOS
 * 26 uses to lift the tab out of the bar into a separate button beside it, and
 * here that reads as a stray control rather than one of the five places you can
 * go — this app's search is a tab like the others.
 *
 * iOS keeps its native material, but is explicitly forbidden from switching
 * to the fully transparent scroll-edge appearance. A photo grid can reach that
 * edge while the bar is still expanded, leaving black labels directly over a
 * photograph with no material behind them.
 *
 * Android is told to keep every label. Material hides them on the unselected
 * items once a bar has more than three, which leaves four unexplained glyphs
 * and one word; these five are destinations rather than tools, and a
 * destination you cannot name is one you have to tap to identify.
 *
 * It is also the one platform given colours. Material picks its own dark
 * surface and its own indicator, both a warmer grey than this palette's, so
 * the bar and the bar at the top of the same screen disagreed. The indicator
 * takes the same washed accent the header already uses behind a selected
 * control, so the one selected thing on screen is tinted the one accent.
 *
 * iOS is left alone: its bar is glass, and naming a colour there would replace
 * the material rather than tint it.
 */
export default function TabsLayout() {
  /*
   * The bar steps aside while photos are picked out.
   *
   * Apple's guidance is that a tab bar and a toolbar never appear together in
   * the same view: a toolbar acts on what is selected, arrives with the
   * selection and leaves with it, and takes the tab bar's place while it is
   * there. Stacking the two was what made the bottom of the screen a mess.
   */
  const { active } = useSelectionBar();

  return (
    <NativeTabs
      hidden={active}
      labelVisibilityMode="labeled"
      backgroundColor={Platform.OS === 'android' ? colors.surface : undefined}
      indicatorColor={Platform.OS === 'android' ? wash(colors.primary) : undefined}
      disableTransparentOnScrollEdge
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="iphone" md="smartphone" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="browse">
        <NativeTabs.Trigger.Icon sf="photo.stack" md="photo_library" />
        <NativeTabs.Trigger.Label>Browse</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="people-and-pets">
        <NativeTabs.Trigger.Icon
          src={require('../../assets/people-and-pets-scan.png')}
          renderingMode="template"
        />
        <NativeTabs.Trigger.Label>People &amp; Pets</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
