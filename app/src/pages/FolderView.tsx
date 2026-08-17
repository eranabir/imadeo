import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronRight,
  CheckCheck,
  Folder,
  FolderPlus,
  LayoutGrid,
  List,
  Lock,
  Pencil,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AssetViewer } from '../components/AssetViewer';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { AlbumCard, FolderCard } from '../components/LibraryCards';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { FolderShareDialog } from '../components/FolderShareDialog';
import { FolderContentsList } from '../components/FolderContentsList';
import { MediaProcessingProgress } from '../components/MediaProcessingProgress';
import { BrowseIcon } from '../components/NavigationIcons';
import { VirtualGrid } from '../components/VirtualGrid';
import { SelectionBar } from '../components/SelectionBar';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage } from '../lib/api';
import { runBatchedOperation } from '../lib/operationProgress';
import { useSelection } from '../lib/useSelection';
import { useAuth } from '../store/auth';
import type { Asset, FolderContents } from '../types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PromptDialog,
  Select,
  Tooltip,
  Input,
  Loading,
} from '../ui';

type FolderSort = 'date' | 'added' | 'name' | 'type' | 'size';

export function BrowsePage() {
  return <LibraryPage rootMode="browse" />;
}

export function FoldersPage() {
  return <LibraryPage rootMode="folders" />;
}

function LibraryPage({ rootMode }: { rootMode: 'browse' | 'folders' }) {
  const { user } = useAuth();
  const { folderId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'folder' | 'album' | 'rename' | 'delete' | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<FolderSort>('date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    localStorage.getItem('imadeo-folder-view') === 'list' ? 'list' : 'grid',
  );

  const { selected, toggle, selectRange, setAnchor, clear, setSelected } = useSelection<Asset>();
  const [viewing, setViewing] = useState<Asset | null>(null);

  const actions = useLibraryActions({
    onShowDetails: setViewing,
    onError: setError,
    selectedIds: [...selected],
    onFolderConverted: (album) =>
      navigate(`${rootMode === 'browse' ? '/browse/albums' : '/albums'}/${album.id}`),
  });

  const afterBulk = () => {
    clear();
    return queryClient.invalidateQueries();
  };

  const favoriteSelected = useMutation({
    mutationFn: async (ids: string[]) =>
      (await api.put('/assets/bulk', { ids, isFavorite: true })).data,
    onSuccess: afterBulk,
    onError: (e) => setError(errorMessage(e)),
  });

  const trashSelected = useMutation({
    mutationFn: async (ids: string[]) =>
      runBatchedOperation(
        ids.length === 1 ? 'Moving photo to Trash' : `Moving ${ids.length} photos to Trash`,
        ids,
        async (batch) => (await api.delete('/assets', { data: { ids: batch } })).data,
      ),
    onSuccess: afterBulk,
    onError: (e) => setError(errorMessage(e)),
  });

  const selectAllPhotos = useMutation({
    mutationFn: async () =>
      (await api.get<{ ids: string[] }>(`/folders/${folderId}/assets/ids`)).data.ids,
    onSuccess: (ids) => setSelected(new Set(ids)),
    onError: (e) => setError(errorMessage(e)),
  });

  const {
    data: contentsPages,
    isLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['folders', folderId ?? 'root', 'contents', sortBy, order],
    queryFn: async ({ pageParam }) =>
      (
        await api.get<FolderContents>(
          `${folderId ? `/folders/${folderId}/contents` : '/folders/root'}?page=${pageParam}&size=250&sortBy=${sortBy}&order=${order}`,
        )
      ).data,
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.pages
        ? lastPage.pagination.page + 1
        : undefined,
  });

  const firstPage = contentsPages?.pages[0];
  const data = firstPage
    ? {
        ...firstPage,
        assets: contentsPages.pages.flatMap((page) => page.assets),
      }
    : undefined;

  /** Search runs over what this folder already returned. */
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);

  const shownFolders = (data?.folders ?? []).filter((f) => matches(f.name));
  const shownAlbums = (data?.albums ?? []).filter((a) => matches(a.name));
  const showAlbums = Boolean(folderId) || rootMode === 'browse';
  const visibleAlbums = showAlbums ? shownAlbums : [];
  const invalidate = () => queryClient.invalidateQueries();
  const onError = (e: unknown) => setError(errorMessage(e));

  const createSubfolder = useMutation({
    mutationFn: async (name: string) =>
      (await api.post('/folders', { name, parentId: folderId ?? undefined })).data,
    onSuccess: invalidate,
    onError,
  });

  const rename = useMutation({
    mutationFn: async (name: string) => (await api.put(`/folders/${folderId}`, { name })).data,
    onSuccess: invalidate,
    onError,
  });

  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/folders/${folderId}`)).data,
    onSuccess: () => {
      void invalidate();
      navigate(rootMode === 'browse' ? '/browse' : '/folders');
    },
    onError,
  });

  const createAlbum = useMutation({
    mutationFn: async (albumName: string) =>
      (await api.post('/albums', { albumName, folderId: folderId ?? null })).data,
    onSuccess: invalidate,
    onError,
  });

  const changeView = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('imadeo-folder-view', mode);
  };

  const changeSort = (next: FolderSort) => {
    setSortBy(next);
    setOrder(next === 'name' || next === 'type' ? 'asc' : 'desc');
  };

  if (isLoading) return <Loading label="Loading folder…" />;
  if (!data) return null;

  const shownAssets = (data?.assets ?? []).filter((asset) => matches(asset.originalFileName));
  const canManage = !data.folder || data.folder.ownerId === user?.id;
  const allFolderPhotosSelected =
    data.pagination.total > 0 &&
    selected.size === data.pagination.total &&
    shownAssets.every((asset) => selected.has(asset.id));
  const canConvertFolder =
    data.pagination.total > 0 && data.folders.length === 0 && data.albums.length === 0;

  const isEmpty =
    shownFolders.length === 0 &&
    visibleAlbums.length === 0 &&
    (!folderId || shownAssets.length === 0);
  const visibleCount =
    shownFolders.length +
    visibleAlbums.length +
    (folderId ? (needle ? shownAssets.length : data.pagination.total) : 0);
  const rootTitle = rootMode === 'browse' ? 'Browse' : 'Folders';
  const folderBasePath = rootMode === 'browse' ? '/browse/folders' : '/folders';
  const albumBasePath = rootMode === 'browse' ? '/browse/albums' : '/albums';
  const orderLabel =
    sortBy === 'type'
      ? order === 'asc' ? 'Photos first' : 'Videos first'
      : sortBy === 'name'
        ? order === 'asc' ? 'A to Z' : 'Z to A'
        : sortBy === 'size'
          ? order === 'asc' ? 'Smallest first' : 'Largest first'
          : order === 'asc' ? 'Oldest first' : 'Newest first';

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        {folderId && (
          <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-content-muted">
            <Link to={rootMode === 'browse' ? '/browse' : '/folders'} className="transition hover:text-content">
              {rootTitle}
            </Link>
            {data.breadcrumbs.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <ChevronRight size={12} />
                <Link to={`${folderBasePath}/${crumb.id}`} className="transition hover:text-content">
                  {crumb.name}
                </Link>
              </span>
            ))}
          </nav>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">
              {data.folder?.name ?? rootTitle}
            </h1>
            {data.folder?.isLocked && <Lock size={15} className="text-content-muted" />}
            <span className="text-xs tabular-nums text-content-muted">
              {visibleCount} {visibleCount === 1 ? 'item' : 'items'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder={folderId ? 'Search this folder…' : `Search ${rootTitle.toLowerCase()}…`}
              adornment={<Search size={14} />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // 32px to sit level with the small buttons beside it.
              size="sm"
              containerClassName="w-44"
              className="rounded-full bg-surface-sunken"
              trailing={
                query ? (
                  <IconButton label="Clear" size="sm" onClick={() => setQuery('')}>
                    <X size={13} />
                  </IconButton>
                ) : undefined
              }
            />

            {folderId && (
              <>
                <Select
                  size="sm"
                  prefix="Sort by"
                  value={sortBy}
                  onChange={changeSort}
                  options={[
                    { value: 'date', label: 'Date taken' },
                    { value: 'added', label: 'Recently added' },
                    { value: 'name', label: 'File name' },
                    { value: 'type', label: 'Type', hint: 'Group photos and videos' },
                    { value: 'size', label: 'File size' },
                  ]}
                />
                <Tooltip label={orderLabel}>
                  <IconButton
                    label={orderLabel}
                    variant="secondary"
                    size="sm"
                    round={false}
                    onClick={() => setOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}
                  >
                    {order === 'asc' ? (
                      <ArrowUpNarrowWide size={15} />
                    ) : (
                      <ArrowDownWideNarrow size={15} />
                    )}
                  </IconButton>
                </Tooltip>
              </>
            )}

            {folderId && (
              <div
                className="flex rounded-control border border-border-subtle bg-surface-raised p-0.5"
                role="group"
                aria-label="Folder view"
              >
                <IconButton
                  label="Grid view"
                  variant={viewMode === 'grid' ? 'primary' : 'ghost'}
                  size="sm"
                  round={false}
                  aria-pressed={viewMode === 'grid'}
                  onClick={() => changeView('grid')}
                >
                  <LayoutGrid size={14} />
                </IconButton>
                <IconButton
                  label="List view"
                  variant={viewMode === 'list' ? 'primary' : 'ghost'}
                  size="sm"
                  round={false}
                  aria-pressed={viewMode === 'list'}
                  onClick={() => changeView('list')}
                >
                  <List size={14} />
                </IconButton>
              </div>
            )}

            {selected.size === 0 && canManage && <Button size="sm" icon={<FolderPlus size={14} />} onClick={() => setDialog('folder')}>
              New folder
            </Button>}
            {selected.size === 0 && showAlbums && canManage && <Button size="sm" icon={<LayoutGrid size={14} />} onClick={() => setDialog('album')}>
              New album
            </Button>}

            {folderId && canManage && data.pagination.total > 0 && (
              <Button
                size="sm"
                icon={<CheckCheck size={14} />}
                disabled={selectAllPhotos.isPending}
                onClick={() => (allFolderPhotosSelected ? clear() : selectAllPhotos.mutate())}
              >
                {allFolderPhotosSelected ? 'Deselect all photos' : 'Select all photos'}
              </Button>
            )}

            {selected.size === 0 && data.folder && canManage && (
              <>
                <Tooltip label="Share folder">
                  <IconButton label="Share folder" variant="secondary" size="sm" round={false} onClick={() => setShareOpen(true)}>
                    <Share2 size={14} />
                  </IconButton>
                </Tooltip>
                <Tooltip label="Rename folder">
                  <IconButton
                    label="Rename folder"
                    variant="secondary"
                    size="sm"
                    round={false}
                    onClick={() => setDialog('rename')}
                  >
                    <Pencil size={14} />
                  </IconButton>
                </Tooltip>
                {canConvertFolder && (
                  <Tooltip label="Convert to album">
                    <IconButton
                      label="Convert to album"
                      variant="secondary"
                      size="sm"
                      round={false}
                      onClick={() => actions.onConvertFolder(data.folder!)}
                    >
                      <LayoutGrid size={14} />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip label="Delete folder">
                  <IconButton
                    label="Delete folder"
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

      {folderId && <MediaProcessingProgress kind="folder" id={folderId} />}

      <div className="px-5 pb-24 pt-4">
        {folderId && viewMode === 'list' && !isEmpty && (
          <>
            <FolderContentsList
              folders={shownFolders}
              albums={visibleAlbums}
              assets={shownAssets}
              folderBasePath={folderBasePath}
              albumBasePath={albumBasePath}
              selected={selected}
              onOpenAsset={setViewing}
              onToggleAsset={toggle}
              onSelectRange={(asset) => selectRange(asset, shownAssets)}
              onAnchorAsset={setAnchor}
              onDropFolder={actions.dropOnFolder}
              onDropAlbum={actions.dropOnAlbum}
              onFolderContextMenu={actions.onFolderContextMenu}
              onAlbumContextMenu={actions.onAlbumContextMenu}
              onAssetContextMenu={actions.onAssetContextMenu}
            />
            <InfiniteScrollSentinel
              enabled={hasNextPage}
              loading={isFetchingNextPage}
              onVisible={() => void fetchNextPage()}
            />
          </>
        )}

        {(!folderId || viewMode === 'grid') && shownFolders.length > 0 && (
          <Section title="Folders">
            <VirtualGrid
              items={shownFolders}
              getKey={(folder) => folder.id}
              minItemWidth={200}
              itemHeight={58}
              gap={8}
              renderItem={(folder) => (
                <FolderCard
                  folder={folder}
                  basePath={folderBasePath}
                  onDrop={actions.dropOnFolder}
                  onContextMenu={actions.onFolderContextMenu}
                />
              )}
            />
          </Section>
        )}

        {(!folderId || viewMode === 'grid') && visibleAlbums.length > 0 && (
          <Section
            title="Albums"
            note={
              <Link to="/albums" className="text-primary hover:underline">
                see every album
              </Link>
            }
          >
            <VirtualGrid
              items={visibleAlbums}
              getKey={(album) => album.id}
              minItemWidth={200}
              itemHeight={(width) => width * 0.75 + 63}
              gap={12}
              renderItem={(album) => (
                <AlbumCard
                  album={album}
                  basePath={albumBasePath}
                  onDrop={actions.dropOnAlbum}
                  onContextMenu={actions.onAlbumContextMenu}
                />
              )}
            />
          </Section>
        )}


        {/* Only inside a folder. The top-level listing is a directory of
            folders and albums, not a photo grid — but a folder you have opened
            should show what is actually in it. */}
        {folderId && viewMode === 'grid' && shownAssets.length > 0 && (
          <section className="mb-7">
            <JustifiedGrid
              assets={shownAssets}
              selected={selected}
              targetRowHeight={user?.preferences.tileSize ?? 220}
              onOpen={setViewing}
              onToggleSelect={toggle}
              onSelectRange={(a) => selectRange(a, shownAssets)}
              onAnchor={setAnchor}
              onContextMenu={actions.onAssetContextMenu}
            />
            <InfiniteScrollSentinel
              enabled={hasNextPage}
              loading={isFetchingNextPage}
              onVisible={() => void fetchNextPage()}
            />
          </section>
        )}

        {isEmpty && (
          <EmptyState
            icon={!folderId && rootMode === 'browse' ? BrowseIcon : Folder}
            title={folderId ? 'This folder is empty' : rootMode === 'browse' ? 'Nothing here yet' : 'No folders yet'}
            description={folderId ? 'Upload photos here, or create a sub-folder to keep things organised.' : rootMode === 'browse' ? 'Create a folder or album to start organising your library.' : 'Create a folder to start organising your library.'}
            action={
              canManage ? (
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  icon={<FolderPlus size={15} />}
                  onClick={() => setDialog('folder')}
                >
                  New folder
                </Button>
                {showAlbums && (
                  <Button icon={<LayoutGrid size={15} />} onClick={() => setDialog('album')}>
                    New album
                  </Button>
                )}
              </div>
              ) : undefined
            }
          />
        )}
      </div>

      {actions.overlays}

      <SelectionBar
        count={selected.size}
        onClear={clear}
        onFavorite={() => favoriteSelected.mutate([...selected])}
        onDownload={() => {
          window.location.href = `/api/assets/download/archive?ids=${[...selected].join(',')}`;
        }}
        onTrash={() => trashSelected.mutate([...selected])}
      />

      {viewing && (
        <AssetViewer
          asset={viewing}
          assets={shownAssets}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}

      {data.folder && canManage && (
        <FolderShareDialog
          folderId={data.folder.id}
          folderName={data.folder.name}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
        />
      )}

      <PromptDialog
        open={dialog === 'folder'}
        title="New folder"
        description={
          data.folder ? `Created inside “${data.folder.name}”.` : 'Created at the top level.'
        }
        label="Folder name"
        placeholder="Iceland"
        onSubmit={(name) => createSubfolder.mutate(name)}
        onClose={() => setDialog(null)}
      />

      <PromptDialog
        open={dialog === 'album'}
        title="New album"
        description={
          data.folder ? `Placed inside “${data.folder.name}”.` : 'Placed at the top level.'
        }
        label="Album name"
        placeholder="Best of the trip"
        onSubmit={(name) => createAlbum.mutate(name)}
        onClose={() => setDialog(null)}
      />

      <PromptDialog
        open={dialog === 'rename'}
        title="Rename folder"
        label="Folder name"
        initialValue={data.folder?.name ?? ''}
        confirmLabel="Rename"
        onSubmit={(name) => rename.mutate(name)}
        onClose={() => setDialog(null)}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        title={`Delete “${data.folder?.name ?? ''}”?`}
        description="The folder, its sub-folders, albums and photos move to Trash and can be restored together for 30 days."
        confirmLabel="Delete folder"
        destructive
        onConfirm={() => remove.mutate()}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">
          {title}
        </h2>
        {note && <p className="text-[11px] text-content-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}
