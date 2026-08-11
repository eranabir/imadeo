import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Folder,
  FolderPlus,
  LayoutGrid,
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
import { FolderShareDialog } from '../components/FolderShareDialog';
import { SelectionBar } from '../components/SelectionBar';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage } from '../lib/api';
import { useSelection } from '../lib/useSelection';
import { useAuth } from '../store/auth';
import type { Asset, FolderContents } from '../types';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PromptDialog,
  Tooltip,
  Input,
  Loading,
} from '../ui';

export function FolderView() {
  const { user } = useAuth();
  const { folderId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'folder' | 'album' | 'rename' | 'delete' | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [query, setQuery] = useState('');

  const { selected, toggle, selectRange, setAnchor, clear } = useSelection<Asset>();
  const [viewing, setViewing] = useState<Asset | null>(null);

  const actions = useLibraryActions({
    onShowDetails: setViewing,
    onError: setError,
    selectedIds: [...selected],
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
    mutationFn: async (ids: string[]) => (await api.post('/assets/trash', { ids })).data,
    onSuccess: afterBulk,
    onError: (e) => setError(errorMessage(e)),
  });

  /**
   * This page browses structure, not pictures: folders and the albums inside
   * them. Photos are reached by opening one of those, so the grid, its
   * selection tools and the sorting that only applied to it are gone.
   */
  const { data, isLoading } = useQuery({
    queryKey: ['folders', folderId ?? 'root', 'contents'],
    queryFn: async () =>
      (
        await api.get<FolderContents>(
          folderId ? `/folders/${folderId}/contents` : '/folders/root',
        )
      ).data,
  });

  /** Search runs over what this folder already returned. */
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);

  const shownFolders = (data?.folders ?? []).filter((f) => matches(f.name));
  const shownAlbums = (data?.albums ?? []).filter((a) => matches(a.name));
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
      navigate('/folders');
    },
    onError,
  });

  const createAlbum = useMutation({
    mutationFn: async (albumName: string) =>
      (await api.post('/albums', { albumName, folderId: folderId ?? null })).data,
    onSuccess: invalidate,
    onError,
  });

  if (isLoading) return <Loading label="Loading folder…" />;
  if (!data) return null;

  const shownAssets = (data?.assets ?? []).filter((asset) => matches(asset.originalFileName));
  const canManage = !data.folder || data.folder.ownerId === user?.id;

  const isEmpty =
    shownFolders.length === 0 &&
    shownAlbums.length === 0 &&
    (!folderId || shownAssets.length === 0);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-content-muted">
          <Link to="/folders" className="transition hover:text-content">
            Folders
          </Link>
          {data.breadcrumbs.map((crumb) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight size={12} />
              <Link to={`/folders/${crumb.id}`} className="transition hover:text-content">
                {crumb.name}
              </Link>
            </span>
          ))}
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">
              {data.folder?.name ?? 'All folders'}
            </h1>
            {data.folder?.isLocked && <Lock size={15} className="text-content-muted" />}
            <span className="text-xs tabular-nums text-content-muted">
              {data.pagination.total} {data.pagination.total === 1 ? 'item' : 'items'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search this folder…"
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

            {canManage && <Button size="sm" icon={<FolderPlus size={14} />} onClick={() => setDialog('folder')}>
              New folder
            </Button>}
            {canManage && <Button size="sm" icon={<LayoutGrid size={14} />} onClick={() => setDialog('album')}>
              New album
            </Button>}

            {data.folder && canManage && (
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

      <div className="px-5 pb-24 pt-4">
        {shownFolders.length > 0 && (
          <Section title="Folders">
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
              {shownFolders.map((folder) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  onDrop={actions.dropOnFolder}
                  onContextMenu={actions.onFolderContextMenu}
                />
              ))}
            </div>
          </Section>
        )}

        {shownAlbums.length > 0 && (
          <Section
            title="Albums"
            note={
              <Link to="/albums" className="text-primary hover:underline">
                see every album
              </Link>
            }
          >
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
              {shownAlbums.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onDrop={actions.dropOnAlbum}
                  onContextMenu={actions.onAlbumContextMenu}
                />
              ))}
            </div>
          </Section>
        )}


        {/* Only inside a folder. The top-level listing is a directory of
            folders and albums, not a photo grid — but a folder you have opened
            should show what is actually in it. */}
        {folderId && shownAssets.length > 0 && (
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
          </section>
        )}

        {isEmpty && (
          <EmptyState
            icon={Folder}
            title="This folder is empty"
            description="Upload photos here, or create a sub-folder to keep things organised."
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
                <Button icon={<LayoutGrid size={15} />} onClick={() => setDialog('album')}>
                  New album
                </Button>
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
        description="Sub-folders go with it and the photos inside move to the trash, where you can restore them for 30 days."
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
