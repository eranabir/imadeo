import { useState } from 'react';
import { Text, View } from 'react-native';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { Header, HeaderAction, useHeaderClearance } from '../components/Header';
import { MediaSortControl, MEDIA_SORT_HEIGHT, type MediaSort } from '../components/MediaSort';
import { PhotoActions } from '../components/PhotoActions';
import { SelectionDock } from '../components/SelectionDock';
import { usePagedResource, type Asset } from '../lib/api';
import { useMediaViewMode } from '../lib/viewMode';
import { colors } from '../theme';

/** A live collection, including favorites beyond the first page of the library. */
export function FavoritesScreen({ serverUrl, onBack }: {
  serverUrl: string;
  onBack: () => void;
}) {
  const [sort, setSort] = useState<MediaSort>('date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useMediaViewMode();
  const media = usePagedResource<Asset>(serverUrl,
    `/assets?isFavorite=true&sortBy=${sort}&order=${order}`);
  const selection = useSelection();
  const clearance = useHeaderClearance(MEDIA_SORT_HEIGHT);
  const total = media.pagination?.total;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={media.items}
        token={media.token}
        loading={media.loading}
        onRefresh={media.reload}
        onChanged={media.reload}
        topInset={clearance}
        viewMode={viewMode}
        selected={selection.ids}
        onToggle={selection.toggle}
        onStartSelecting={selection.start}
        hasMore={media.hasMore}
        loadingMore={media.loadingMore}
        onLoadMore={media.loadMore}
        header={media.error ? (
          <Text style={{ color: colors.danger, fontSize: 14, paddingHorizontal: 16, marginBottom: 16 }}>
            {media.error}
          </Text>
        ) : null}
        emptyIcon="heart"
        emptyTitle={media.loading ? 'Loading…' : media.error ? 'Could not load favorites' : 'No favorites yet'}
        emptyBody={media.error ? 'Pull down to try again.' : 'Tap the heart on a photo or video to find it here.'}
      />

      <PhotoActions
        serverUrl={serverUrl}
        ids={selection.ids}
        allFavorite={selection.ids.length > 0 &&
          selection.ids.every(id => media.items.find(asset => asset.id === id)?.isFavorite)}
        onClear={selection.clear}
        onDone={() => {
          selection.clear();
          void media.reload();
        }}
      />

      <Header
        title="Favorites"
        subtitle={total === undefined ? undefined : `${total.toLocaleString()} ${total === 1 ? 'item' : 'items'}`}
        icon="heart-filled"
        onBack={onBack}
        action={<HeaderAction
          label={viewMode === 'grid' ? 'Show as list' : 'Show as grid'}
          icon={viewMode === 'grid' ? 'list' : 'grid'}
          compact
          onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
        />}
      >
        <MediaSortControl
          sort={sort}
          order={order}
          onSort={value => {
            selection.clear();
            setSort(value);
            setOrder(value === 'date' ? 'desc' : 'asc');
          }}
          onOrder={setOrder}
        />
      </Header>
      <SelectionDock />
    </View>
  );
}
