import { Text, View } from 'react-native';
import { colors } from '../theme';
import { Segmented } from './Segmented';
import { Touchable } from './ui';

export type MediaSort = 'date' | 'name' | 'type';
export function MediaSortControl({ sort, order, onSort, onOrder }: {
  sort: MediaSort;
  order: 'asc' | 'desc';
  onSort: (sort: MediaSort) => void;
  onOrder: (order: 'asc' | 'desc') => void;
}) {
  return <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
    <Segmented segments={[
      { id: 'date', label: 'Date' },
      { id: 'name', label: 'Name' },
      { id: 'type', label: 'Type' },
    ]} active={sort} onChange={onSort} />
    <Touchable label={`Sort ${order === 'asc' ? 'descending' : 'ascending'}`}
      onPress={() => onOrder(order === 'asc' ? 'desc' : 'asc')} style={{ paddingVertical: 10 }}>
      <Text style={{ color: colors.primary, textAlign: 'right' }}>
        {order === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
      </Text>
    </Touchable>
  </View>;
}
