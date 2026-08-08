import { Text, View } from 'react-native';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { useHeaderClearance } from '../components/Header';
import { useHeaderSlot } from '../header';
import { PhotoActions } from '../components/PhotoActions';
import { useResource, type Asset, type Paged } from '../lib/api';
import { colors } from '../theme';

interface Props {
  /** Where this screen publishes its bar. */
  slot: string;
  serverUrl: string;
  city: string;
  title: string;
  onBack: () => void;
}

/** Everything taken in one town or city. */
export function PlaceScreen({ serverUrl, city, title, slot, onBack }: Props) {
  const { data, token, error, loading, reload } = useResource<Paged<Asset>>(
    serverUrl,
    `/assets?city=${encodeURIComponent(city)}&size=500&sortBy=date&order=desc`,
  );
  const clearance = useHeaderClearance();
  const selection = useSelection();

  const total = data?.pagination?.total ?? 0;

  useHeaderSlot(
    slot,
    {
      title,
      icon: 'pin',
      subtitle: total
        ? `${total.toLocaleString()} ${total === 1 ? 'photo' : 'photos'}`
        : undefined,
      onBack,
    },
    [title, total, onBack],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={data?.items ?? []}
        token={token}
        loading={loading}
        onRefresh={reload}
        topInset={clearance}
        selected={selection.ids}
        onToggle={selection.toggle}
        onStartSelecting={selection.start}
        onChanged={reload}
        header={
          error ? (
            <Text style={{ color: colors.danger, fontSize: 14, padding: 16 }}>{error}</Text>
          ) : null
        }
        emptyIcon="pin"
        emptyTitle={loading ? 'Loading…' : 'Nothing here'}
        emptyBody={`No photos are recorded as taken in ${title}.`}
      />

      <PhotoActions
        serverUrl={serverUrl}
        ids={selection.ids}
        allFavorite={
          selection.ids.length > 0 &&
          selection.ids.every((id) => data?.items.find((a) => a.id === id)?.isFavorite)
        }
        onClear={selection.clear}
        onDone={() => {
          selection.clear();
          reload();
        }}
      />
    </View>
  );
}
