import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { AssetViewer } from '../components/AssetViewer';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { AlbumCard, FolderCard } from '../components/LibraryCards';
import { VaultDialog, useVaultStatus } from '../components/VaultGate';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage } from '../lib/api';
import type { Album, Asset, FolderNode, Paginated } from '../types';
import { Button, EmptyState } from '../ui';

/**
 * Everything filed as locked, behind a private password.
 *
 * Nothing here is fetched until the session is unlocked, so a locked library
 * stays invisible rather than merely hidden by the UI.
 */
export function LockedPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [askPin, setAskPin] = useState(false);
  const [viewing, setViewing] = useState<Asset | null>(null);

  const { data: vault } = useVaultStatus();
  const actions = useLibraryActions({ onError: setError, onShowDetails: setViewing });

  const unlocked = vault?.isUnlocked ?? false;

  const { data: folders = [] } = useQuery({
    queryKey: ['folders', 'tree', 'locked'],
    queryFn: async () =>
      (await api.get<FolderNode[]>('/folders/tree', { params: { includeLocked: true } })).data,
    enabled: unlocked,
  });

  const { data: albums = [] } = useQuery({
    queryKey: ['albums', 'locked'],
    queryFn: async () =>
      (await api.get<Album[]>('/albums', { params: { includeLocked: true } })).data,
    enabled: unlocked,
  });

  const media = useInfiniteQuery({
    queryKey: ['assets', 'locked'],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<Paginated<Asset>>('/assets/locked', {
          params: { page: pageParam, size: 150 },
        })
      ).data,
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.pages ? last.pagination.page + 1 : undefined,
    enabled: unlocked,
  });

  const lockNow = useMutation({
    mutationFn: async () => (await api.post('/auth/vault/lock')).data,
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e) => setError(errorMessage(e)),
  });

  const flatten = (nodes: FolderNode[]): FolderNode[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);

  const lockedFolders = flatten(folders).filter((folder) => folder.isLocked);
  const lockedAlbums = albums.filter((album) => album.isLocked);
  const lockedAssets = media.data?.pages.flatMap((page) => page.items) ?? [];
  const lockedAssetTotal = media.data?.pages[0]?.pagination.total ?? 0;
  const isEmpty = lockedFolders.length === 0 && lockedAlbums.length === 0 && lockedAssetTotal === 0;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Lock size={16} className="text-content-muted" />
          <h1 className="text-lg font-semibold tracking-tight">Locked</h1>
          {unlocked && (
            <span className="text-xs text-content-muted">
              {lockedAssetTotal} media · {lockedFolders.length} folders · {lockedAlbums.length} albums
            </span>
          )}
        </div>

        {unlocked && (
          <Button size="sm" icon={<Lock size={14} />} onClick={() => lockNow.mutate()}>
            Lock now
          </Button>
        )}
      </header>

      {error && (
        <p className="mx-5 mt-4 rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {!unlocked ? (
        <EmptyState
          icon={Lock}
          title={vault?.isConfigured ? 'Locked items are locked' : 'Set up Locked'}
          description={
            vault?.isConfigured
              ? 'Enter your private password to see the photos, videos, folders and albums you have locked away. They stay out of the timeline, search results and share links.'
              : 'Choose a private password to start locking photos, videos, folders and albums. Locked items are hidden from the timeline, search and every share link.'
          }
          action={
            <Button
              variant="primary"
              icon={vault?.isConfigured ? <LockOpen size={15} /> : <ShieldCheck size={15} />}
              onClick={() => setAskPin(true)}
            >
              {vault?.isConfigured ? 'Unlock' : 'Set a private password'}
            </Button>
          }
        />
      ) : isEmpty ? (
        <EmptyState
          icon={Lock}
          title="Nothing is locked yet"
          description="Open a photo or right-click any photo, folder or album and choose Lock."
        />
      ) : (
        <div className="space-y-7 px-5 pb-24 pt-4">
          {lockedAssets.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                Photos & videos
              </h2>
              <JustifiedGrid
                assets={lockedAssets}
                onOpen={setViewing}
                onContextMenu={actions.onAssetContextMenu}
              />
              <InfiniteScrollSentinel
                enabled={Boolean(media.hasNextPage)}
                loading={media.isFetchingNextPage}
                onVisible={() => void media.fetchNextPage()}
              />
            </section>
          )}

          {lockedFolders.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                Folders
              </h2>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
                {lockedFolders.map((folder) => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    onDrop={actions.dropOnFolder}
                    onContextMenu={actions.onFolderContextMenu}
                  />
                ))}
              </div>
            </section>
          )}

          {lockedAlbums.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                Albums
              </h2>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
                {lockedAlbums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    onDrop={actions.dropOnAlbum}
                    onContextMenu={actions.onAlbumContextMenu}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {actions.overlays}

      {viewing && (
        <AssetViewer
          asset={viewing}
          assets={lockedAssets}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}

      <VaultDialog open={askPin} onClose={() => setAskPin(false)} />
    </div>
  );
}
