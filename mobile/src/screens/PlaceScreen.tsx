import { Text, View } from 'react-native';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { Header, useHeaderClearance } from '../components/Header';
import { PhotoActions } from '../components/PhotoActions';
import { SelectionDock } from '../components/SelectionDock';
import { usePagedResource, type Asset } from '../lib/api';
import { colors } from '../theme';

interface Props {
  serverUrl: string;
  city: string;
  title: string;
  onBack: () => void;
}

/** Everything taken in one town or city. */
export function PlaceScreen({ serverUrl, city, title, onBack }: Props) {
  const { items, pagination, token, error, loading, reload, hasMore, loadingMore, loadMore } = usePagedResource<Asset>(
    serverUrl,
    `/assets?city=${encodeURIComponent(city)}&sortBy=date&order=desc`,
  );
  const clearance = useHeaderClearance();
  const selection = useSelection();

  const total = pagination?.total ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={items}
        token={token}
        loading={loading}
        onRefresh={reload}
        topInset={clearance}
        selected={selection.ids}
        onToggle={selection.toggle}
        onStartSelecting={selection.start}
        onChanged={reload}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
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
          selection.ids.every((id) => items.find((a) => a.id === id)?.isFavorite)
        }
        onClear={selection.clear}
        onDone={() => {
          selection.clear();
          reload();
        }}
      />
      <Header
        title={title}
        icon="pin"
        subtitle={total ? `${total.toLocaleString()} ${total === 1 ? 'photo' : 'photos'}` : undefined}
        onBack={onBack}
      />
      <SelectionDock />
    </View>
  );
}
