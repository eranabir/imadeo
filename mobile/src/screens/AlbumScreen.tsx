import { Text, View } from 'react-native';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { Header, useHeaderClearance } from '../components/Header';
import { PhotoActions } from '../components/PhotoActions';
import { useResource, type Asset } from '../lib/api';
import { colors } from '../theme';

interface AlbumDetail {
  id: string;
  name: string;
  description: string | null;
  assetCount: number;
  shared?: boolean;
  albumUsers?: { user: { id: string; name: string | null; email: string } }[];
  assets: Asset[];
  pagination: { page: number; size: number; total: number };
}

interface Props {
  serverUrl: string;
  albumId: string;
  title: string;
  onBack: () => void;
}

/** Everything inside one album. */
export function AlbumScreen({ serverUrl, albumId, title, onBack }: Props) {
  const { data, token, error, loading, reload } = useResource<AlbumDetail>(
    serverUrl,
    `/albums/${albumId}?size=500&sortBy=date&order=desc`,
  );
  const clearance = useHeaderClearance();
  const selection = useSelection();

  const shared = data?.albumUsers?.length ?? 0;
  const subtitle = [
    data ? `${data.assetCount.toLocaleString()} ${data.assetCount === 1 ? 'photo' : 'photos'}` : '…',
    shared > 0 ? `shared with ${shared}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header
        title={data?.name ?? title}
        subtitle={subtitle}
        icon="album"
       
        onBack={onBack}
      />

      <AssetGrid
        serverUrl={serverUrl}
        assets={data?.assets ?? []}
        token={token}
        loading={loading}
        onRefresh={reload}
        topInset={clearance}
        header={
          error || data?.description ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
              {error && <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>}
              {data?.description && (
                <Text style={{ color: colors.muted, fontSize: 14.5, lineHeight: 21 }}>
                  {data.description}
                </Text>
              )}
            </View>
          ) : null
        }
        selected={selection.ids}
        onToggle={selection.toggle}
        onStartSelecting={selection.start}
        onChanged={reload}
        emptyIcon="album"
        emptyTitle={loading ? 'Loading…' : 'This album is empty'}
        emptyBody="Photos added to it, here or on the web, show up in this grid."
      />

      <PhotoActions
        serverUrl={serverUrl}
        ids={selection.ids}
        allFavorite={
          selection.ids.length > 0 &&
          selection.ids.every((id) => data?.assets.find((a) => a.id === id)?.isFavorite)
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
