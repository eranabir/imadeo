import { ImadeoBrowseTabs } from '../../modules/imadeo-browse-tabs';
import { resolvedDark } from '../lib/preferences';
import { colors } from '../theme';
import type { BrowseTabsProps } from './BrowseTabs.types';
import { BROWSE_TAB_HEIGHT } from './browseTabGeometry';
const symbols = {
  library: 'photo.stack', folder: 'folder', album: 'square.grid.2x2',
  pin: 'mappin.and.ellipse', shared: 'square.and.arrow.up',
  person: 'person', pet: 'pawprint', sparkle: 'sparkles',
  'people-and-pets': 'person.crop.square', photo: 'photo',
} as const;
/** UIKit owns the glass, selection lens, symbols, labels and interactions. */
export function BrowseTabs<T extends string>({ segments, active, onChange,
  height = BROWSE_TAB_HEIGHT, onHeightChange }: BrowseTabsProps<T>) {
  return <ImadeoBrowseTabs
    style={{ height, width: '100%' }}
    options={segments.map(segment => ({ id: segment.id, label: segment.label,
      symbol: symbols[segment.icon as keyof typeof symbols] ?? '' }))}
    selection={active}
    accentColor={colors.primary}
    dark={resolvedDark()}
    onSelectionChange={({ nativeEvent }) => {
      const segment = segments.find(option => option.id === nativeEvent.id);
      if (segment) onChange(segment.id);
    }}
    onMetrics={({ nativeEvent }) => {
      // Keep UIKit's complete native layout; its bottom-edge gutter is not
      // part of this inline header. The native platter and shadows stay intact.
      if (Number.isFinite(nativeEvent.height) && nativeEvent.height > 0) {
        onHeightChange?.(Math.min(nativeEvent.height, BROWSE_TAB_HEIGHT));
      }
    }}
  />;
}
