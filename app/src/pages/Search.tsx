import { useQuery } from '@tanstack/react-query';
import { Folder as FolderIcon, LayoutGrid, Search as SearchIcon, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AssetViewer } from '../components/AssetViewer';
import { JustifiedGrid } from '../components/JustifiedGrid';
import {
  SearchOptions,
  countActive,
  emptyFilters,
  toParams,
  type SearchFilters,
} from '../components/SearchOptions';
import { SelectionBar } from '../components/SelectionBar';
import { useLibraryActions } from '../components/useLibraryActions';
import { api } from '../lib/api';
import { useSelection } from '../lib/useSelection';
import { useAuth } from '../store/auth';
import type { Album, Asset, FolderNode, Paginated } from '../types';

interface PlaceResults extends Paginated<Asset> {
  folders: Pick<FolderNode, 'id' | 'name'>[];
  albums: (Pick<Album, 'id' | 'name'> & { assetCount: number })[];
}
import { Button, EmptyState } from '../ui';

export function SearchPage() {
  const [params] = useSearchParams();
  const { user } = useAuth();

  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [viewing, setViewing] = useState<Asset | null>(null);
  const { selected, toggle, selectRange, setAnchor, clear } = useSelection<Asset>();

  /**
   * Two ways in from the top bar: plain text typed into the box arrives as ?q=,
   * and the options modal hands over the whole form as ?filters=.
   */
  const q = params.get('q') ?? '';
  const encoded = params.get('filters');

  useEffect(() => {
    if (encoded) {
      try {
        setFilters({ ...emptyFilters, ...(JSON.parse(encoded) as SearchFilters) });
        return;
      } catch {
        // A malformed URL should not blank the page.
      }
    }
    if (q) setFilters((current) => ({ ...current, mode: 'filename', text: q }));
  }, [q, encoded]);

  const contextSearch = filters.mode === 'context' && filters.text.trim() !== '';
  const placeSearch = filters.mode === 'place' && filters.text.trim() !== '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', 'search', filters],
    queryFn: async () =>
      placeSearch
        ? (
            await api.get<PlaceResults>('/assets/search/places', {
              params: { text: filters.text },
            })
          ).data
        : contextSearch
        ? // Ordered by how well each picture matches the phrase, so this cannot
          // be combined with the ordinary filters — it is a different question.
          (
            await api.get<Paginated<Asset>>('/assets/search/context', {
              params: { text: filters.text, size: 200 },
            })
          ).data
        : (await api.get<Paginated<Asset>>('/assets', { params: toParams(filters) })).data,
    retry: false,
  });

  const assets = data?.items ?? [];
  const places = (data as PlaceResults | undefined) ?? { folders: [], albums: [] } as never;
  const actions = useLibraryActions({ onShowDetails: setViewing, selectedIds: [...selected] });
  const active = countActive(filters);

  /** One removable chip per filter in play, so what narrowed the list is visible. */
  const summary: { label: string; clear: () => void }[] = [];
  const drop = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => () =>
    setFilters((current) => ({ ...current, [key]: value }));

  if (filters.text) {
    summary.push({
      label: filters.mode === 'context' ? `“${filters.text}”` : filters.text,
      clear: drop('text', ''),
    });
  }
  if (filters.subjectIds.length) {
    summary.push({ label: `${filters.subjectIds.length} selected`, clear: drop('subjectIds', []) });
  }
  if (filters.takenAfter) {
    summary.push({ label: `from ${filters.takenAfter}`, clear: drop('takenAfter', '') });
  }
  if (filters.takenBefore) {
    summary.push({ label: `to ${filters.takenBefore}`, clear: drop('takenBefore', '') });
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight">Search</h1>
            <span className="text-xs tabular-nums text-content-muted">
              {isLoading ? 'searching…' : `${assets.length} result${assets.length === 1 ? '' : 's'}`}
            </span>
          </div>

          <Button
            size="sm"
            variant={active > 0 ? 'primary' : undefined}
            icon={<SlidersHorizontal size={14} />}
            onClick={() => setOptionsOpen(true)}
          >
            Search options{active > 0 ? ` (${active})` : ''}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {/* Every filter in play, each removable on its own — otherwise a
              narrow result set is a mystery you have to reopen the form to solve. */}
          {summary.map((entry) => (
            <button
              key={entry.label}
              type="button"
              onClick={entry.clear}
              title="Remove this filter"
              className="flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/20"
            >
              {entry.label}
              <X size={11} />
            </button>
          ))}

          {active > 0 && (
            <button
              type="button"
              onClick={() => setFilters(emptyFilters)}
              className="ml-1 text-xs text-content-muted hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      </header>

      {/* Matched albums and folders come first: when someone searches a folder
          name, the folder itself is usually what they wanted, not its photos. */}
      {placeSearch && (places.folders.length > 0 || places.albums.length > 0) && (
        <div className="flex flex-wrap gap-2 px-5 pt-4">
          {places.folders.map((folder) => (
            <Link
              key={folder.id}
              to={`/folders/${folder.id}`}
              className="flex items-center gap-2 rounded-panel border border-border-subtle bg-surface-raised px-3.5 py-2.5 text-sm transition hover:border-content-muted/50"
            >
              <FolderIcon size={16} className="text-nav-folders" />
              {folder.name}
            </Link>
          ))}
          {places.albums.map((album) => (
            <Link
              key={album.id}
              to={`/albums/${album.id}`}
              className="flex items-center gap-2 rounded-panel border border-border-subtle bg-surface-raised px-3.5 py-2.5 text-sm transition hover:border-content-muted/50"
            >
              <LayoutGrid size={16} className="text-amber-500" />
              {album.name}
              <span className="text-xs text-content-muted">{album.assetCount}</span>
            </Link>
          ))}
        </div>
      )}

      {contextSearch && (
        <p className="mx-5 mt-3 rounded-control bg-primary-soft px-3.5 py-2 text-xs text-primary">
          Showing photos that look like “{filters.text}”, closest first. The other filters do not
          apply to this kind of search.
        </p>
      )}

      {error ? (
        <EmptyState
          icon={SearchIcon}
          title="Search by content is not ready"
          description={
            (error as { response?: { data?: { message?: string } } }).response?.data?.message ??
            'The machine-learning service is not available.'
          }
        />
      ) : !isLoading && assets.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="Nothing matched"
          description="Try loosening a filter, or search by what is in the picture instead."
          action={
            active > 0 ? (
              <Button variant="primary" onClick={() => setFilters(emptyFilters)}>
                Clear all filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="px-2 pb-24 pt-3">
          <JustifiedGrid
            assets={assets}
            selected={selected}
            targetRowHeight={user?.preferences.tileSize ?? 220}
            onOpen={setViewing}
            onToggleSelect={toggle}
            onSelectRange={(a) => selectRange(a, assets)}
            onAnchor={setAnchor}
            onContextMenu={actions.onAssetContextMenu}
          />
        </div>
      )}

      {actions.overlays}

      <SelectionBar
        count={selected.size}
        onClear={clear}
        onDownload={() => {
          window.location.href = `/api/assets/download/archive?ids=${[...selected].join(',')}`;
        }}
      />

      <SearchOptions
        open={optionsOpen}
        initial={filters}
        onClose={() => setOptionsOpen(false)}
        onSearch={(next) => {
          setFilters(next);
          setOptionsOpen(false);
        }}
      />

      {viewing && (
        <AssetViewer
          asset={viewing}
          assets={assets}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}
    </div>
  );
}
