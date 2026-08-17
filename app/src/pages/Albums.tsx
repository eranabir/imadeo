import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  LayoutGrid,
  List,
  MoreVertical,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlbumCover } from '../components/AlbumCover';
import { AlbumCard } from '../components/LibraryCards';
import { VirtualGrid } from '../components/VirtualGrid';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage } from '../lib/api';
import { startDrag, type DragPayload } from '../lib/dnd';
import { formatDate } from '../lib/format';
import { useDropTarget } from '../lib/useDropTarget';
import { useAuth } from '../store/auth';
import type { Album } from '../types';
import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  Input,
  PromptDialog,
  Select,
  Tooltip,
} from '../ui';

type SortKey = 'updated' | 'created' | 'name' | 'count';
type FilterKey = 'all' | 'shared' | 'private' | 'inFolder' | 'topLevel';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'shared', label: 'Shared' },
  { key: 'private', label: 'Not shared' },
  { key: 'inFolder', label: 'In a folder' },
  { key: 'topLevel', label: 'Top level' },
];

export function AlbumsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('updated');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    localStorage.getItem('imadeo-album-view') === 'list' ? 'list' : 'grid',
  );

  // Rename, move and delete all live in the shared hook, so an album behaves
  // the same here as it does in the sidebar and inside a folder.
  const actions = useLibraryActions({ onError: setError });

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: async () => (await api.get<Album[]>('/albums')).data,
  });

  const create = useMutation({
    mutationFn: async (albumName: string) => (await api.post('/albums', { albumName })).data,
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e) => setError(errorMessage(e)),
  });

  const needle = query.trim().toLowerCase();

  const visible = albums
    .filter((album) => {
      if (needle && !album.name.toLowerCase().includes(needle)) return false;

      switch (filter) {
        case 'shared':
          return Boolean(album.shared);
        case 'private':
          return !album.shared;
        case 'inFolder':
          return Boolean(album.folderId);
        case 'topLevel':
          return !album.folderId;
        default:
          return true;
      }
    })
    .sort((a, b) => {
      let comparison: number;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'count':
          comparison = a.assetCount - b.assetCount;
          break;
        case 'created':
          comparison = a.createdAt.localeCompare(b.createdAt);
          break;
        default:
          comparison = a.updatedAt.localeCompare(b.updatedAt);
      }
      return order === 'asc' ? comparison : -comparison;
    });

  const changeView = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('imadeo-album-view', mode);
  };

  const changeSort = (next: SortKey) => {
    setSortBy(next);
    setOrder(next === 'name' ? 'asc' : 'desc');
  };

  const orderLabel =
    sortBy === 'name'
      ? order === 'asc'
        ? 'A to Z'
        : 'Z to A'
      : sortBy === 'count'
        ? order === 'asc'
          ? 'Fewest first'
          : 'Most first'
        : order === 'asc'
          ? 'Oldest first'
          : 'Newest first';

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight">Albums</h1>
            <span className="text-xs tabular-nums text-content-muted">
              {isLoading
                ? ''
                : // Say how many of how many whenever a filter is narrowing things.
                  visible.length === albums.length
                  ? `${albums.length} ${albums.length === 1 ? 'album' : 'albums'}`
                  : `${visible.length} of ${albums.length}`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder="Find an album…"
              adornment={<Search size={14} />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              size="sm"
              containerClassName="w-48"
              className="rounded-full bg-surface-sunken"
              trailing={
                query ? (
                  <IconButton label="Clear" size="sm" onClick={() => setQuery('')}>
                    <X size={13} />
                  </IconButton>
                ) : undefined
              }
            />
            <Select
              size="sm"
              prefix="Sort by"
              value={sortBy}
              onChange={changeSort}
              options={[
                { value: 'updated', label: 'Recently updated' },
                { value: 'created', label: 'Recently created' },
                { value: 'name', label: 'Name', hint: 'A to Z' },
                { value: 'count', label: 'Number of photos', hint: 'Largest first' },
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
            <div
              className="flex rounded-control border border-border-subtle bg-surface-raised p-0.5"
              role="group"
              aria-label="Albums view"
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
            <Button
              size="sm"
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => setCreating(true)}
            >
              New album
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {FILTERS.map(({ key, label }) => (
            <Chip key={key} active={filter === key} onClick={() => setFilter(key)}>
              {label}
            </Chip>
          ))}
        </div>
      </header>

      {error && (
        <p className="mx-5 mt-4 rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {albums.length === 0 && !isLoading ? (
        <EmptyState
          icon={LayoutGrid}
          title="No albums yet"
          description="Albums group photos without moving them. Every album lives here, including the ones filed inside a folder."
          action={
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
              Create your first album
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nothing matches"
          description={
            needle
              ? `No album is called “${query}”.`
              : 'No album fits that filter. Try another one.'
          }
          action={
            <Button
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="px-5 pb-24 pt-4">
          {viewMode === 'grid' ? (
            <VirtualGrid
              items={visible}
              getKey={(album) => album.id}
              minItemWidth={210}
              itemHeight={(width) => width * 0.75 + 63}
              gap={16}
              renderItem={(album) => (
                <AlbumCard
                  album={album}
                  withMenuButton
                  onDrop={actions.dropOnAlbum}
                  onContextMenu={actions.onAlbumContextMenu}
                  meta={
                    <>
                      {album.assetCount} items
                      {/* Where it is filed, so the folder context is not lost here. */}
                      {album.folder && ` · ${album.folder.name}`}
                      {` · ${formatDate(album.updatedAt, user?.preferences.locale)}`}
                    </>
                  }
                />
              )}
            />
          ) : (
            <AlbumsList
              albums={visible}
              locale={user?.preferences.locale}
              onDrop={actions.dropOnAlbum}
              onContextMenu={actions.onAlbumContextMenu}
            />
          )}
        </div>
      )}

      <PromptDialog
        open={creating}
        title="New album"
        description="You can file it into a folder afterwards, or just drag it onto one."
        label="Album name"
        placeholder="Summer 2024"
        onSubmit={(name) => create.mutate(name)}
        onClose={() => setCreating(false)}
      />

      {actions.overlays}
    </div>
  );
}

const albumRowGrid =
  'grid h-full grid-cols-[minmax(0,1fr)_5rem_2rem] items-center gap-3 px-3 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,0.6fr)_5rem_2rem] lg:grid-cols-[minmax(0,1fr)_minmax(8rem,0.7fr)_5rem_8rem_2rem]';

function AlbumsList({
  albums,
  locale,
  onDrop,
  onContextMenu,
}: {
  albums: Album[];
  locale?: string;
  onDrop: (albumId: string, payload: DragPayload) => void;
  onContextMenu: (album: Album, event: React.MouseEvent) => void;
}) {
  return (
    <section className="overflow-hidden rounded-panel border border-border-subtle bg-surface-raised">
      <div
        className={clsx(
          albumRowGrid,
          'h-9 border-b border-border-subtle bg-surface-sunken text-[11px] font-semibold uppercase tracking-wider text-content-muted',
        )}
      >
        <span>Name</span>
        <span className="hidden sm:block">Location</span>
        <span>Items</span>
        <span className="hidden lg:block">Updated</span>
        <span />
      </div>
      <VirtualGrid
        items={albums}
        getKey={(album) => album.id}
        minItemWidth={200}
        columnCount={1}
        itemHeight={64}
        gap={0}
        renderItem={(album) => (
          <AlbumListRow
            album={album}
            locale={locale}
            onDrop={onDrop}
            onContextMenu={onContextMenu}
          />
        )}
      />
    </section>
  );
}

function AlbumListRow({
  album,
  locale,
  onDrop,
  onContextMenu,
}: {
  album: Album;
  locale?: string;
  onDrop: (albumId: string, payload: DragPayload) => void;
  onContextMenu: (album: Album, event: React.MouseEvent) => void;
}) {
  const { isOver, dropProps } = useDropTarget({
    effect: 'copy',
    onDrop: (payload) => onDrop(album.id, payload),
  });

  return (
    <div
      draggable
      onDragStart={(event) =>
        startDrag(event, { kind: 'album', ids: [album.id], label: album.name })
      }
      {...dropProps}
      onContextMenu={(event) => onContextMenu(album, event)}
      className={clsx(
        albumRowGrid,
        'group relative border-b border-border-subtle transition last:border-b-0 hover:bg-surface-sunken',
        isOver && 'bg-primary/15 ring-2 ring-inset ring-primary/40',
      )}
    >
      <Link to={`/albums/${album.id}`} className="flex min-w-0 items-center gap-2.5">
        <span className="h-10 w-10 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
          <AlbumCover album={album} />
        </span>
        <span className="min-w-0">
          <Tooltip label={album.name} onlyWhenOverflow>
            <span className="block truncate text-sm font-medium">{album.name}</span>
          </Tooltip>
          <span className="block truncate text-xs text-content-muted sm:hidden">
            {album.folder?.name ?? 'Top level'}
          </span>
        </span>
      </Link>
      <Tooltip label={album.folder?.path ?? 'Top level'} onlyWhenOverflow>
        <span className="hidden truncate text-xs text-content-muted sm:block">
          {album.folder?.name ?? 'Top level'}
        </span>
      </Tooltip>
      <span className="text-xs tabular-nums text-content-muted">{album.assetCount}</span>
      <span className="hidden text-xs text-content-muted lg:block">
        {formatDate(album.updatedAt, locale)}
      </span>
      <IconButton
        label={`Options for ${album.name}`}
        size="sm"
        className="opacity-0 transition focus:opacity-100 group-hover:opacity-100"
        onClick={(event) => onContextMenu(album, event)}
      >
        <MoreVertical size={15} />
      </IconButton>
      {isOver && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-primary/25">
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white shadow">
            Add to “{album.name}”
          </span>
        </span>
      )}
    </div>
  );
}
