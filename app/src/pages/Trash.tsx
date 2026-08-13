import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, LayoutGrid, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage } from '../lib/api';
import { useSelection } from '../lib/useSelection';
import { formatDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Album, Asset } from '../types';
import { Button, ConfirmDialog, EmptyState } from '../ui';

interface TrashedFolder {
  id: string;
  name: string;
  depth: number;
  folderCount: number;
  albumCount: number;
  assetCount: number;
}

interface TrashedAlbum extends Album {
  deletedAt: string;
}

export function TrashPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { selected, toggle, selectRange, setAnchor, clear } = useSelection<Asset>();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'selected' | 'all' | null>(null);

  const actions = useLibraryActions({ trashed: true, selectedIds: [...selected] });

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets', 'trash'],
    queryFn: async () => (await api.get<Asset[]>('/assets/trash')).data,
  });
  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ['folders', 'trash'],
    queryFn: async () => (await api.get<TrashedFolder[]>('/folders/trash')).data,
  });
  const { data: albums = [], isLoading: albumsLoading } = useQuery({
    queryKey: ['albums', 'trash'],
    queryFn: async () => (await api.get<TrashedAlbum[]>('/albums/trash')).data,
  });

  const afterChange = () => {
    clear();
    return queryClient.invalidateQueries();
  };
  const onError = (e: unknown) => setError(errorMessage(e));

  const restore = useMutation({
    mutationFn: async (ids: string[]) => (await api.post('/assets/trash/restore', { ids })).data,
    onSuccess: afterChange,
    onError,
  });

  const restoreAll = useMutation({
    mutationFn: async () => {
      // Parent folder trees first; independently deleted albums and loose
      // photos can then be restored without pointing at missing structure.
      for (const folder of [...folders].sort((a, b) => a.depth - b.depth)) {
        await api.post(`/folders/${folder.id}/restore`);
      }
      await Promise.all(albums.map((album) => api.post(`/albums/${album.id}/restore`)));
      return (await api.post('/assets/trash/restore-all')).data;
    },
    onSuccess: afterChange,
    onError,
  });

  const restoreFolder = useMutation({
    mutationFn: async (id: string) => (await api.post(`/folders/${id}/restore`)).data,
    onSuccess: afterChange,
    onError,
  });

  const restoreAlbum = useMutation({
    mutationFn: async (id: string) => (await api.post(`/albums/${id}/restore`)).data,
    onSuccess: afterChange,
    onError,
  });

  const deleteForever = useMutation({
    mutationFn: async (ids: string[]) =>
      (await api.delete('/assets', { data: { ids, force: true } })).data,
    onSuccess: afterChange,
    onError,
  });

  const emptyTrash = useMutation({
    mutationFn: async () => {
      await api.post('/assets/trash/empty');
      await Promise.all(albums.map((album) => api.delete(`/albums/${album.id}/permanent`)));
      for (const folder of [...folders].sort((a, b) => b.depth - a.depth)) {
        await api.delete(`/folders/${folder.id}/permanent`);
      }
    },
    onSuccess: afterChange,
    onError,
  });

  const structureCount = folders.length + albums.length;
  const totalCount = structureCount + assets.length;
  const loading = isLoading || foldersLoading || albumsLoading;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Trash</h1>
          <span className="text-xs text-content-muted">
            {loading
              ? ''
              : totalCount === 0
                ? 'Empty'
                : `${totalCount} items · removed automatically after 30 days`}
          </span>
        </div>

        {totalCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 ? (
              <>
                <Button
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={() => restore.mutate([...selected])}
                >
                  Restore {selected.size}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  onClick={() => setConfirm('selected')}
                >
                  Delete forever
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={() => restoreAll.mutate()}
                >
                  Restore all
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  onClick={() => setConfirm('all')}
                >
                  Empty trash
                </Button>
              </>
            )}
          </div>
        )}
      </header>

      {error && (
        <p className="mx-5 mt-4 rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {structureCount > 0 && (
        <section className="mx-5 mt-4 rounded-panel border border-border-subtle bg-surface-raised p-3">
          <h2 className="mb-2 text-sm font-semibold">Folders and albums</h2>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {folders.map((folder) => (
              <div
                key={folder.id}
                className="flex items-center gap-3 rounded-control border border-border-subtle bg-surface px-3 py-2.5"
              >
                <FolderOpen size={18} className="shrink-0 text-nav-folders" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{folder.name}</span>
                  <span className="block text-xs text-content-muted">
                    {folder.folderCount} {folder.folderCount === 1 ? 'folder' : 'folders'} ·{' '}
                    {folder.albumCount} {folder.albumCount === 1 ? 'album' : 'albums'} ·{' '}
                    {folder.assetCount} items
                  </span>
                </span>
                <Button
                  size="sm"
                  icon={<RotateCcw size={13} />}
                  disabled={restoreFolder.isPending}
                  onClick={() => restoreFolder.mutate(folder.id)}
                >
                  Restore
                </Button>
              </div>
            ))}
            {albums.map((album) => (
              <div
                key={album.id}
                className="flex items-center gap-3 rounded-control border border-border-subtle bg-surface px-3 py-2.5"
              >
                <LayoutGrid size={18} className="shrink-0 text-nav-albums" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{album.name}</span>
                  <span className="block text-xs text-content-muted">{album.assetCount} items</span>
                </span>
                <Button
                  size="sm"
                  icon={<RotateCcw size={13} />}
                  disabled={restoreAlbum.isPending}
                  onClick={() => restoreAlbum.mutate(album.id)}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {totalCount === 0 && !loading ? (
        <EmptyState
          icon={Trash2}
          title="The trash is empty"
          description="Deleted folders, albums and photos wait here for 30 days before they are removed for good."
        />
      ) : assets.length > 0 ? (
        <div className="px-2 pb-24 pt-3">
          <p className="mb-3 px-3 text-xs text-content-muted">
            Click to select, or right-click a photo for more.
            {assets[0]?.purgeAt &&
              ` The oldest item is removed on ${formatDate(assets[0].purgeAt, user?.preferences.locale)}.`}
          </p>
          <JustifiedGrid
            assets={assets}
            selected={selected}
            targetRowHeight={user?.preferences.tileSize ?? 220}
            onOpen={toggle}
            onToggleSelect={toggle}
            onSelectRange={(a) => selectRange(a, assets)}
            onAnchor={setAnchor}
            onContextMenu={actions.onAssetContextMenu}
          />
        </div>
      ) : null}

      {actions.overlays}

      <ConfirmDialog
        open={confirm === 'selected'}
        title={`Permanently delete ${selected.size} items?`}
        description="The files are removed from disk. This cannot be undone."
        confirmLabel="Delete forever"
        destructive
        onConfirm={() => deleteForever.mutate([...selected])}
        onClose={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirm === 'all'}
        title="Empty the trash?"
        description={`All ${totalCount} items are removed permanently. This cannot be undone.`}
        confirmLabel="Empty trash"
        destructive
        onConfirm={() => emptyTrash.mutate()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
