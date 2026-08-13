import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { AlbumCard } from '../components/LibraryCards';
import { VirtualGrid } from '../components/VirtualGrid';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Album } from '../types';
import { Button, Chip, EmptyState, IconButton, Input, PromptDialog, Select } from '../ui';

type SortKey = 'updated' | 'created' | 'name' | 'count' | 'size';
type FilterKey = 'all' | 'shared' | 'private' | 'inFolder' | 'topLevel';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'shared', label: 'Shared' },
  { key: 'private', label: 'Not shared' },
  { key: 'inFolder', label: 'In a folder' },
  { key: 'topLevel', label: 'Top level' },
];

export function Albums() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('updated');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

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
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'count':
        case 'size':
          return b.assetCount - a.assetCount;
        case 'created':
          return b.createdAt.localeCompare(a.createdAt);
        default:
          return b.updatedAt.localeCompare(a.updatedAt);
      }
    });

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
              onChange={setSortBy}
              options={[
                { value: 'updated', label: 'Recently updated' },
                { value: 'created', label: 'Recently created' },
                { value: 'name', label: 'Name', hint: 'A to Z' },
                { value: 'count', label: 'Number of photos', hint: 'Largest first' },
              ]}
            />
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
