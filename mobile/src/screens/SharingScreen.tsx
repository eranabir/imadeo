import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AssetGrid } from '../components/AssetGrid';
import { AlbumCard, FolderCard, Section } from '../components/Cards';
import { type Album, type Asset, type FolderContents, type Paged, useResource } from '../lib/api';
import { colors } from '../theme';

interface Me {
  id: string;
}

/**
 * The things other accounts have shared with the signed-in person.
 *
 * It lives under Browse rather than competing for one of the five native tabs.
 * A shared photo is useful, but must not be mistaken for something the person
 * backed up or can reorganise.
 */
export function SharingShelf({ serverUrl, topInset }: { serverUrl: string; topInset: number }) {
  const router = useRouter();
  const me = useResource<Me>(serverUrl, '/users/me');
  const assets = useResource<Paged<Asset>>(serverUrl, '/assets?size=500&sortBy=date&order=desc');
  const albums = useResource<Album[]>(serverUrl, '/albums?shared=true');
  const root = useResource<FolderContents>(serverUrl, '/folders/root?size=1');

  const myId = me.data?.id;
  const receivedAssets = myId ? (assets.data?.items ?? []).filter((asset) => asset.ownerId !== myId) : [];
  const receivedAlbums = myId
    ? (albums.data ?? []).filter((album) => album.owner?.id !== myId)
    : [];
  const receivedFolders = (root.data?.folders ?? []).filter((folder) => folder.shared);
  const hasContainers = receivedFolders.length > 0 || receivedAlbums.length > 0;
  const loading = me.loading || assets.loading || albums.loading || root.loading;
  const error = me.error ?? assets.error ?? albums.error ?? root.error;

  const reload = () => {
    void me.reload();
    void assets.reload();
    void albums.reload();
    void root.reload();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={receivedAssets}
        token={assets.token ?? albums.token ?? root.token}
        loading={loading}
        onRefresh={reload}
        topInset={topInset}
        header={
          <View style={{ paddingTop: 16 }}>
            {error && (
              <Text style={{ color: colors.danger, fontSize: 14, paddingHorizontal: 16, marginBottom: 16 }}>
                {error}
              </Text>
            )}
            {receivedFolders.length > 0 && (
              <Section title="Folders" trailing={`${receivedFolders.length}`}>
                <View style={{ paddingHorizontal: 16, gap: 8 }}>
                  {receivedFolders.map((folder) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      detail="Shared with you · View only"
                      onPress={() =>
                        router.push({ pathname: '/folder/[id]', params: { id: folder.id, title: folder.name } })
                      }
                    />
                  ))}
                </View>
              </Section>
            )}
            {receivedAlbums.length > 0 && (
              <Section title="Albums" trailing={`${receivedAlbums.length}`}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12 }}>
                  {receivedAlbums.map((album) => (
                    <View key={album.id} style={{ width: '47.5%' }}>
                      <AlbumCard
                        serverUrl={serverUrl}
                        album={album}
                        token={albums.token}
                        onPress={() =>
                          router.push({ pathname: '/album/[id]', params: { id: album.id, title: album.name } })
                        }
                      />
                    </View>
                  ))}
                </View>
              </Section>
            )}
            {receivedAssets.length > 0 && <Section title="Photos" trailing={`${receivedAssets.length}`} />}
          </View>
        }
        showEmptyState={!hasContainers}
        emptyIcon="shared"
        emptyTitle={loading ? 'Loading…' : 'Nothing shared with you yet'}
        emptyBody="Photos, albums, and folders shared with you appear here."
      />
    </View>
  );
}
