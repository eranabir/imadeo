import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ChevronRight, ImagePlus, LayoutGrid, Pencil, Share2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AssetViewer } from '../components/AssetViewer';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { MediaProcessingProgress } from '../components/MediaProcessingProgress';
import { ShareDialog } from '../components/ShareDialog';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage } from '../lib/api';
import { useSelection } from '../lib/useSelection';
import { formatDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Album, Asset } from '../types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PromptDialog,
  Tooltip,
  Loading,
} from '../ui';

interface AlbumDetailResponse extends Album {
  assets: Asset[];
  access: 'owner' | 'editor' | 'viewer';
  breadcrumbs: { id: string; name: string; isLocked: boolean }[];
  pagination: { page: number; size: number; total: number };
}

export function BrowseAlbumPage() {
  return <AlbumPageContent rootMode="browse" />;
}

export function AlbumPage() {
  return <AlbumPageContent rootMode="albums" />;
}

function AlbumPageContent({ rootMode }: { rootMode: 'browse' | 'albums' }) {
  const { albumId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [viewing, setViewing] = useState<Asset | null>(null);
  const { selected, toggle, selectRange, setAnchor, clear, setSelected } = useSelection<Asset>();
  const [dialog, setDialog] = useState<'rename' | 'delete' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions = useLibraryActions({ onShowDetails: setViewing, selectedIds: [...selected] });

  const {
    data: albumPages,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['albums', albumId],
    queryFn: async ({ pageParam }) =>
      (
        await api.get<AlbumDetailResponse>(
          `/albums/${albumId}?page=${pageParam}&size=250`,
        )
      ).data,
    enabled: Boolean(albumId),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page * lastPage.pagination.size < lastPage.pagination.total
        ? lastPage.pagination.page + 1
        : undefined,
  });

  const firstPage = albumPages?.pages[0];
  const album = firstPage
    ? {
        ...firstPage,
        assets: albumPages.pages.flatMap((page) => page.assets),
      }
    : undefined;

  const invalidate = () => queryClient.invalidateQueries();
  const onError = (e: unknown) => setError(errorMessage(e));

  const rename = useMutation({
    mutationFn: async (albumName: string) =>
      (await api.put(`/albums/${albumId}`, { albumName })).data,
    onSuccess: invalidate,
    onError,
  });

  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/albums/${albumId}`)).data,
    onSuccess: () => {
      void invalidate();
      navigate(rootMode === 'browse' ? '/browse' : '/albums');
    },
    onError,
  });

  const removeAssets = useMutation({
    mutationFn: async (assetIds: string[]) =>
      (await api.delete(`/albums/${albumId}/assets`, { data: { assetIds } })).data,
    onSuccess: () => {
      clear();
      return invalidate();
    },
    onError,
  });

  const selectAllAssets = useMutation({
    mutationFn: async () =>
      (await api.get<{ ids: string[] }>(`/albums/${albumId}/assets/ids`)).data.ids,
    onSuccess: (ids) => setSelected(new Set(ids)),
    onError,
  });

  if (isLoading) return <Loading label="Loading album…" />;
  if (!album) return null;

  const allSelected = album.assetCount > 0 && selected.size === album.assetCount;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-content-muted">
          <Link to={rootMode === 'browse' ? '/browse' : '/albums'} className="transition hover:text-content">
            {rootMode === 'browse' ? 'Browse' : 'Albums'}
          </Link>
          {album.breadcrumbs.map((crumb) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight size={12} />
              <Link
                to={`${rootMode === 'browse' ? '/browse/folders' : '/folders'}/${crumb.id}`}
                className="transition hover:text-content"
              >
                {crumb.name}
              </Link>
            </span>
          ))}
          <span className="flex items-center gap-1 text-content">
            <ChevronRight size={12} />
            {album.name}
          </span>
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight">{album.name}</h1>
            <span className="text-xs tabular-nums text-content-muted">
              {album.assetCount} {album.assetCount === 1 ? 'item' : 'items'} ·{' '}
              {formatDate(album.updatedAt, user?.preferences.locale)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {album.assetCount > 0 && (
              <Button
                size="sm"
                icon={<CheckCheck size={14} />}
                disabled={selectAllAssets.isPending}
                onClick={() => (allSelected ? clear() : selectAllAssets.mutate())}
              >
                {selectAllAssets.isPending
                  ? 'Selecting…'
                  : allSelected
                    ? 'Deselect all'
                    : 'Select all'}
              </Button>
            )}

            {selected.size > 0 && (
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={14} />}
                onClick={() => removeAssets.mutate([...selected])}
              >
                Remove {selected.size} from album
              </Button>
            )}

            {album.access === 'owner' && (
              <>
                <Tooltip label="Rename album">
                  <IconButton
                    label="Rename album"
                    variant="secondary"
                    size="sm"
                    round={false}
                    onClick={() => setDialog('rename')}
                  >
                    <Pencil size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip label="Share album">
                  <IconButton
                    label="Share album"
                    variant="secondary"
                    size="sm"
                    round={false}
                    onClick={() => setDialog('share')}
                  >
                    <Share2 size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip label="Delete album">
                  <IconButton
                    label="Delete album"
                    variant="secondary"
                    size="sm"
                    round={false}
                    onClick={() => setDialog('delete')}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </header>

      {error && (
        <p className="mx-5 mt-4 rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {albumId && <MediaProcessingProgress kind="album" id={albumId} />}

      {album.assets.length === 0 ? (
        <EmptyState
          icon={ImagePlus}
          title="This album is empty"
          description="Drag photos onto the album in the sidebar, or right-click any photo and choose “Add to album”."
          action={
            <Button variant="primary" icon={<LayoutGrid size={15} />} onClick={() => navigate('/')}>
              Browse photos
            </Button>
          }
        />
      ) : (
        <div className="px-2 pb-24 pt-3">
          <JustifiedGrid
            assets={album.assets}
            selected={selected}
            targetRowHeight={user?.preferences.tileSize ?? 220}
            onOpen={setViewing}
            onToggleSelect={toggle}
            onSelectRange={(a) => selectRange(a, album.assets)}
            onAnchor={setAnchor}
            onContextMenu={actions.onAssetContextMenu}
          />
          <InfiniteScrollSentinel
            enabled={hasNextPage}
            loading={isFetchingNextPage}
            onVisible={() => void fetchNextPage()}
          />
        </div>
      )}

      {actions.overlays}

      {viewing && (
        <AssetViewer
          asset={viewing}
          assets={album.assets}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}

      <PromptDialog
        open={dialog === 'rename'}
        title="Rename album"
        label="Album name"
        initialValue={album.name}
        confirmLabel="Rename"
        onSubmit={(name) => rename.mutate(name)}
        onClose={() => setDialog(null)}
      />

      <ShareDialog
        album={album}
        open={dialog === 'share'}
        onClose={() => setDialog(null)}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        title={`Delete “${album.name}”?`}
        description="The album and its photos move to Trash and can be restored together for 30 days."
        confirmLabel="Delete album"
        destructive
        onConfirm={() => remove.mutate()}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
