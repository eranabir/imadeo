import { useCallback, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AssetGrid } from '../components/AssetGrid';
import { AlbumCard, FolderCard, Section } from '../components/Cards';
import { Header, HeaderAction, useHeaderClearance } from '../components/Header';
import { VaultSheet, type VaultStatus } from '../components/sheets';
import { Button } from '../components/ui';
import {
  request,
  usePagedResource,
  useResource,
  type Album,
  type Asset,
  type Folder,
} from '../lib/api';
import { colors } from '../theme';

function flattenFolders(folders: Folder[]): Folder[] {
  return folders.flatMap((folder) => [folder, ...flattenFolders(folder.children ?? [])]);
}

export function LockedScreen({
  serverUrl,
  onBack,
}: {
  serverUrl: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [unlocking, setUnlocking] = useState(false);
  const [locking, setLocking] = useState(false);
  const status = useResource<VaultStatus>(serverUrl, '/auth/vault');
  const unlocked = status.data?.isUnlocked === true;
  const media = usePagedResource<Asset>(serverUrl, unlocked ? '/assets/locked' : null);
  const folderTree = useResource<Folder[]>(
    serverUrl,
    unlocked ? '/folders/tree?includeLocked=true' : null,
  );
  const albums = useResource<Album[]>(
    serverUrl,
    unlocked ? '/albums?includeLocked=true' : null,
  );
  const clearance = useHeaderClearance();

  const lockedFolders = useMemo(
    () => flattenFolders(folderTree.data ?? []).filter((folder) => folder.isLocked),
    [folderTree.data],
  );
  const lockedFolderIds = useMemo(
    () => new Set(lockedFolders.map((folder) => folder.id)),
    [lockedFolders],
  );
  const rootFolders = useMemo(
    () => lockedFolders.filter((folder) => !folder.parentId || !lockedFolderIds.has(folder.parentId)),
    [lockedFolders, lockedFolderIds],
  );
  const rootAlbums = useMemo(
    () =>
      (albums.data ?? []).filter(
        (album) => album.isLocked !== false && (!album.folderId || !lockedFolderIds.has(album.folderId)),
      ),
    [albums.data, lockedFolderIds],
  );
  const hasContainers = rootFolders.length > 0 || rootAlbums.length > 0;
  const loading = status.loading || (unlocked && (media.loading || folderTree.loading || albums.loading));
  const error = media.error ?? folderTree.error ?? albums.error;

  const reload = useCallback(() => {
    void status.reload();
    void media.reload();
    void folderTree.reload();
    void albums.reload();
  }, [status.reload, media.reload, folderTree.reload, albums.reload]);

  const lock = async () => {
    if (locking) return;
    setLocking(true);
    try {
      await request(serverUrl, '/auth/vault/lock', { method: 'POST' });
      await status.reload();
    } catch (cause) {
      Alert.alert('Could not lock Locked', cause instanceof Error ? cause.message : 'Try again.');
    } finally {
      setLocking(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={media.items}
        token={media.token ?? folderTree.token ?? albums.token ?? status.token}
        loading={loading}
        onRefresh={reload}
        topInset={clearance}
        onChanged={reload}
        hasMore={media.hasMore}
        loadingMore={media.loadingMore}
        onLoadMore={media.loadMore}
        emptyIcon="lock"
        emptyTitle={unlocked ? 'Nothing locked yet' : 'Locked is protected'}
        emptyBody={
          unlocked
            ? 'Photos and videos you move to Locked appear here.'
            : 'Enter your private password to see locked photos and videos on this device.'
        }
        emptyExtra={
          unlocked ? null : (
            <View style={{ marginTop: 20 }}>
              <Button
                label={status.data?.isConfigured === false ? 'Set private password' : 'Unlock'}
                icon="unlock"
                onPress={() => setUnlocking(true)}
              />
            </View>
          )
        }
        showEmptyState={!hasContainers}
        header={
          unlocked && (hasContainers || error) ? (
            <View style={{ paddingTop: 16 }}>
              {error ? (
                <Text
                  style={{
                    color: colors.danger,
                    fontSize: 14,
                    lineHeight: 20,
                    paddingHorizontal: 16,
                    marginBottom: 16,
                  }}
                >
                  {error}
                </Text>
              ) : null}
              {rootFolders.length > 0 ? (
                <Section title="Folders" trailing={`${rootFolders.length}`}>
                  <View style={{ paddingHorizontal: 16, gap: 8 }}>
                    {rootFolders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        onPress={() =>
                          router.push({
                            pathname: '/folder/[id]',
                            params: { id: folder.id, title: folder.name, locked: '1' },
                          })
                        }
                      />
                    ))}
                  </View>
                </Section>
              ) : null}
              {rootAlbums.length > 0 ? (
                <Section title="Albums" trailing={`${rootAlbums.length}`}>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      paddingHorizontal: 16,
                      gap: 12,
                    }}
                  >
                    {rootAlbums.map((album) => (
                      <View key={album.id} style={{ width: '47.5%' }}>
                        <AlbumCard
                          serverUrl={serverUrl}
                          album={album}
                          token={albums.token ?? media.token}
                          onPress={() =>
                            router.push({
                              pathname: '/album/[id]',
                              params: { id: album.id, title: album.name, locked: '1' },
                            })
                          }
                        />
                      </View>
                    ))}
                  </View>
                </Section>
              ) : null}
              {media.items.length > 0 ? (
                <Section
                  title="Photos & videos"
                  trailing={(media.pagination?.total ?? media.items.length).toLocaleString()}
                />
              ) : null}
            </View>
          ) : null
        }
      />

      <Header
        title="Locked"
        subtitle={
          unlocked
            ? `${(media.pagination?.total ?? 0).toLocaleString()} media · ${rootFolders.length} folders · ${rootAlbums.length} albums`
            : undefined
        }
        icon="lock"
        onBack={onBack}
        action={
          unlocked ? (
            <HeaderAction label={locking ? 'Locking…' : 'Lock'} icon="lock" onPress={() => void lock()} />
          ) : undefined
        }
      />
      <VaultSheet
        open={unlocking}
        serverUrl={serverUrl}
        onClose={() => setUnlocking(false)}
        onUnlocked={() => void status.reload()}
      />
    </View>
  );
}
