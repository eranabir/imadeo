import { requireNativeViewManager } from 'expo-modules-core';
import type { ColorValue, NativeSyntheticEvent, ViewProps } from 'react-native';

export interface BrowseTabOption {
  id: string;
  label: string;
  /** SF Symbol name. UIKit draws both the symbol and the title. */
  symbol: string;
}

export interface BrowseTabMetrics {
  /** Natural height of the entire UITabBar; use for list/header clearance. */
  height: number;
  /** Public control bounds have no additional outer horizontal inset. */
  inset: number;
  controlHeight: number;
}

export interface ImadeoBrowseTabsProps extends ViewProps {
  options: BrowseTabOption[];
  selection: string;
  accentColor?: ColorValue;
  unselectedColor?: ColorValue;
  dark: boolean;
  onSelectionChange?: (event: NativeSyntheticEvent<{ id: string }>) => void;
  onMetrics?: (event: NativeSyntheticEvent<BrowseTabMetrics>) => void;
}

/** Requires the local ImadeoBrowseTabs module in the installed native build. */
export const ImadeoBrowseTabs = requireNativeViewManager<ImadeoBrowseTabsProps>('ImadeoBrowseTabs');
export default ImadeoBrowseTabs;
