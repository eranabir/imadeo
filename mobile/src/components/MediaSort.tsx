import { useState } from 'react';
import { Text, View } from 'react-native';
import { colors, radius } from '../theme';
import { Icon } from './Icon';
import { Sheet, SheetRow, Touchable } from './ui';

export type MediaSort = 'date' | 'name' | 'type';
export const MEDIA_SORT_HEIGHT = 48;
export function MediaSortControl({ sort, order, onSort, onOrder }: {
  sort: MediaSort;
  order: 'asc' | 'desc';
  onSort: (sort: MediaSort) => void;
  onOrder: (order: 'asc' | 'desc') => void;
}) {
  const [open, setOpen] = useState(false);
  const label = sort[0].toUpperCase() + sort.slice(1);
  return <>
    <View style={{ height: MEDIA_SORT_HEIGHT, paddingHorizontal: 16, paddingBottom: 4, alignItems: 'flex-start' }}>
      <Touchable radius={radius.sm} label={`Sort: ${label}, ${order === 'asc' ? 'ascending' : 'descending'}`}
        onPress={() => setOpen(true)} style={{ height: 44, paddingRight: 12,
          flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="sort" size={20} color={colors.primary} />
        <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
          {label} {order === 'asc' ? '↑' : '↓'}
        </Text>
      </Touchable>
    </View>
    <Sheet open={open} title="Sort by" onClose={() => setOpen(false)}>
      {(['date', 'name', 'type'] as const).map(field => (
        <SheetRow key={field} icon={sort === field ? 'check' : 'sort'}
          label={`${field[0].toUpperCase() + field.slice(1)}${sort === field ? (order === 'asc' ? ' ↑' : ' ↓') : ''}`}
          onPress={() => {
            if (sort === field) onOrder(order === 'asc' ? 'desc' : 'asc');
            else onSort(field);
            setOpen(false);
          }} />
      ))}
    </Sheet>
  </>;
}
