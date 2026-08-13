import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronRight, Folder, Home, LayoutGrid, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { Album, FolderNode } from '../types';
import { Button, Dialog, Input } from '../ui';

type TreeAlbum = NonNullable<FolderNode['albums']>[number];

interface Props {
  open: boolean;
  /** How many photos are being moved, for the wording. */
  count: number;
  /** Overrides the default "Move photo" heading for folders and albums. */
  title?: string;
  /** Albums are only valid destinations for photos. */
  allowAlbums?: boolean;
  /** A folder cannot be moved into itself or its own subtree. */
  excludeFolderId?: string;
  onClose: () => void;
  onMoveToFolder: (folderId: string | null) => void;
  onAddToAlbum: (albumId: string) => void;
}

/**
 * One tree containing both folders and the albums filed inside them, so picking
 * a destination is a single act rather than a choice of category first.
 *
 * Folders and albums still mean different things — a folder is where the file
 * lives, an album is a grouping that leaves it in place — so the row for each
 * says which it is rather than hiding the difference.
 */
export function MoveDialog({
  open,
  count,
  title,
  allowAlbums = true,
  excludeFolderId,
  onClose,
  onMoveToFolder,
  onAddToAlbum,
}: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: folders = [] } = useQuery({
    queryKey: ['folders', 'tree'],
    queryFn: async () => (await api.get<FolderNode[]>('/folders/tree')).data,
    enabled: open,
  });

  const { data: albums = [] } = useQuery({
    queryKey: ['albums'],
    queryFn: async () => (await api.get<Album[]>('/albums')).data,
    enabled: open,
  });

  /** Albums that are not filed under any folder, shown at the top level. */
  const looseAlbums = useMemo<TreeAlbum[]>(
    () =>
      albums
        .filter((album) => !album.folderId)
        .map((album) => ({
          id: album.id,
          name: album.name,
          assetCount: album.assetCount,
          coverAssetId: album.coverAssetId,
          coverAssetIds: album.coverAssetIds ?? [],
        })),
    [albums],
  );

  const needle = query.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);

  /** Keep a folder when it matches, or when anything beneath it does. */
  const subtreeMatches = (folder: FolderNode): boolean =>
    matches(folder.name) ||
    (folder.albums ?? []).some((a) => matches(a.name)) ||
    folder.children.some(subtreeMatches);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderFolder = (folder: FolderNode, depth: number): React.ReactNode => {
    if (!subtreeMatches(folder)) return null;
    // Moving a folder into itself would detach the branch from the tree.
    if (excludeFolderId && folder.id === excludeFolderId) return null;

    const childAlbums = allowAlbums
      ? (folder.albums ?? []).filter((a) => matches(a.name) || matches(folder.name))
      : [];
    const hasChildren = folder.children.length > 0 || childAlbums.length > 0;
    // While searching everything stays open so matches deeper down are visible.
    const isOpen = needle ? true : !collapsed.has(folder.id);

    return (
      <div key={folder.id}>
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => toggle(folder.id)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            style={{ marginLeft: `${depth * 16}px` }}
            className={clsx(
              'grid h-6 w-6 shrink-0 place-items-center rounded transition',
              hasChildren ? 'hover:bg-surface-sunken' : 'invisible',
            )}
          >
            <ChevronRight size={13} className={clsx('transition-transform', isOpen && 'rotate-90')} />
          </button>

          <button
            type="button"
            onClick={() => {
              onMoveToFolder(folder.id);
              onClose();
            }}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 py-2 text-left text-sm transition hover:bg-surface-sunken"
          >
            <Folder size={15} className="shrink-0 text-nav-folders" />
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            <span className="shrink-0 text-[11px] text-content-muted">Folder</span>
          </button>
        </div>

        {isOpen && (
          <>
            {folder.children.map((child) => renderFolder(child, depth + 1))}
            {childAlbums.map((album) => renderAlbum(album, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const renderAlbum = (album: TreeAlbum, depth: number) => (
    <div key={album.id} className="flex items-center">
      <span style={{ marginLeft: `${depth * 16}px` }} className="h-6 w-6 shrink-0" />
      <button
        type="button"
        onClick={() => {
          onAddToAlbum(album.id);
          onClose();
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 py-2 text-left text-sm transition hover:bg-surface-sunken"
      >
        {album.coverAssetId ? (
          <img
            src={`/api/assets/${album.coverAssetId}/thumbnail`}
            alt=""
            className="h-[18px] w-[18px] shrink-0 rounded object-cover"
          />
        ) : (
          <LayoutGrid size={15} className="shrink-0 text-content-muted" />
        )}
        <span className="min-w-0 flex-1 truncate">{album.name}</span>
        <span className="shrink-0 text-[11px] text-content-muted">Album</span>
      </button>
    </div>
  );

  const rows = [
    ...folders.map((folder) => renderFolder(folder, 0)),
    ...(allowAlbums
      ? looseAlbums.filter((a) => matches(a.name)).map((album) => renderAlbum(album, 0))
      : []),
  ].filter(Boolean);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="md"
      title={title ?? (count === 1 ? 'Move photo' : `Move ${count} photos`)}
      description={
        allowAlbums
          ? 'Pick a folder to file it under, or an album to add it to.'
          : 'Pick the folder to file it under.'
      }
    >
      <Input
        placeholder={allowAlbums ? 'Find a folder or album…' : 'Find a folder…'}
        adornment={<Search size={15} />}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />

      <div className="mt-3 max-h-80 overflow-y-auto">
        {!needle && (
          <div className="flex items-center">
            <span className="h-6 w-6 shrink-0" />
            <button
              type="button"
              onClick={() => {
                onMoveToFolder(null);
                onClose();
              }}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-control px-2 py-2 text-left text-sm transition hover:bg-surface-sunken"
            >
              <Home size={15} className="shrink-0 text-content-muted" />
              <span className="min-w-0 flex-1 truncate">Top level</span>
              <span className="shrink-0 text-[11px] text-content-muted">No folder</span>
            </button>
          </div>
        )}

        {rows.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-content-muted">
            Nothing matches “{query}”.
          </p>
        )}

        {rows}
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
