import { Segmented } from './Segmented';
import { View } from 'react-native';
import type { BrowseTabsProps } from './BrowseTabs.types';

export function BrowseTabs<T extends string>(props: BrowseTabsProps<T>) {
  return <View onLayout={event => props.onHeightChange?.(event.nativeEvent.layout.height)}>
    <Segmented {...props} />
  </View>;
}
