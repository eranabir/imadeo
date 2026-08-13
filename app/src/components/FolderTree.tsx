import clsx from 'clsx';
import { ChevronRight, Folder, FolderOpen, Lock } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { startDrag, type DragPayload } from '../lib/dnd';
import { useDropTarget } from '../lib/useDropTarget';
import { useTree } from '../store/tree';
import type { FolderNode } from '../types';
import { Tooltip } from '../ui';
import { RetryingImage } from './RetryingImage';

type TreeAlbum = NonNullable<FolderNode['albums']>[number];

interface Handlers {
  /** Something was dropped onto a folder. */
  onDropOnFolder?: (folderId: string, payload: DragPayload) => void;
  /** Photos were dropped onto an album. */
  onDropOnAlbum?: (albumId: string, payload: DragPayload) => void;
  onFolderContextMenu?: (
    folder: Pick<FolderNode, 'id' | 'name' | 'isLocked'>,
    event: React.MouseEvent,
  ) => void;
  onAlbumContextMenu?: (album: { id: string; name: string }, event: React.MouseEvent) => void;
}

interface Props extends Handlers {
  folders: FolderNode[];
  rootAlbums?: TreeAlbum[];
  activeId?: string;
  folderBasePath?: string;
  albumBasePath?: string;
}

export function FolderTree({
  folders,
  rootAlbums = [],
  activeId,
  folderBasePath = '/folders',
  albumBasePath = '/albums',
  ...handlers
}: Props) {
  if (folders.length === 0 && rootAlbums.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-content-muted">
        Nothing in Browse yet. Create a folder or album to start organising.
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {folders.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          activeId={activeId}
          folderBasePath={folderBasePath}
          albumBasePath={albumBasePath}
          {...handlers}
        />
      ))}
      {rootAlbums.map((album) => (
        <AlbumRow
          key={album.id}
          album={album}
          depth={0}
          albumBasePath={albumBasePath}
          onDropOnAlbum={handlers.onDropOnAlbum}
          onAlbumContextMenu={handlers.onAlbumContextMenu}
        />
      ))}
    </ul>
  );
}

function FolderRow({
  folder,
  activeId,
  folderBasePath = '/folders',
  albumBasePath = '/albums',
  onDropOnFolder,
  onDropOnAlbum,
  onFolderContextMenu,
  onAlbumContextMenu,
}: Handlers & {
  folder: FolderNode;
  activeId?: string;
  folderBasePath?: string;
  albumBasePath?: string;
}) {
  // Expansion lives in a store so it survives navigation and page reloads.
  const open = useTree((state) => state.expanded.has(folder.id));
  const toggle = useTree((state) => state.toggle);
  const setOpen = (next: boolean) => {
    if (next !== open) toggle(folder.id);
  };

  const albums = folder.albums ?? [];
  // Albums count towards whether the folder is worth expanding.
  const hasChildren = folder.children.length > 0 || albums.length > 0;

  const { isOver: dropTarget, dropProps } = useDropTarget({
    effect: 'move',
    onDrop: (payload) => onDropOnFolder?.(folder.id, payload),
    // Expand on hover so something can be dropped deeper in the tree.
    onEnter: () => {
      if (!open && hasChildren) setOpen(true);
    },
  });

  return (
    <li>
      <div
        className={clsx(
          'group relative flex items-center gap-1 rounded-md pr-3.5 transition',
          activeId === folder.id
            ? // The folder being viewed gets the primary bar as well as the tint,
              // so it stays obvious once several branches are open.
              'bg-primary-soft font-medium text-primary before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-primary'
            : 'hover:bg-surface-sunken',
          // Solid fill rather than an outline: at this row height a ring reads
          // as a rendering glitch, a filled target reads as "drop here".
          dropTarget && 'bg-primary text-white',
        )}
        style={{ paddingLeft: `${folder.depth * 12}px` }}
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          startDrag(event, { kind: 'folder', ids: [folder.id], label: folder.name });
        }}
        {...dropProps}
        onContextMenu={(event) => onFolderContextMenu?.(folder, event)}
      >
        <button
          type="button"
          onClick={() => toggle(folder.id)}
          className={clsx(
            'grid h-6 w-6 shrink-0 place-items-center rounded transition',
            hasChildren ? 'hover:bg-border-subtle' : 'invisible',
          )}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <ChevronRight size={14} className={clsx('transition-transform', open && 'rotate-90')} />
        </button>

        <NavLink
          to={`${folderBasePath}/${folder.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm"
        >
          {folder.isLocked ? (
            <Lock size={15} className="shrink-0 opacity-70" />
          ) : open && hasChildren ? (
            <FolderOpen size={15} className="shrink-0 text-nav-folders" />
          ) : (
            <Folder size={15} className="shrink-0 text-nav-folders" />
          )}
          <Tooltip label={folder.name} onlyWhenOverflow>
            <span className="truncate">{folder.name}</span>
          </Tooltip>
        </NavLink>

        {folder.assetCount > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums opacity-70">{folder.assetCount}</span>
        )}
      </div>

      {open && hasChildren && (
        <ul className="space-y-0.5">
          {folder.children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              activeId={activeId}
              folderBasePath={folderBasePath}
              albumBasePath={albumBasePath}
              onDropOnFolder={onDropOnFolder}
              onDropOnAlbum={onDropOnAlbum}
              onFolderContextMenu={onFolderContextMenu}
              onAlbumContextMenu={onAlbumContextMenu}
            />
          ))}

          {albums.map((album) => (
            <AlbumRow
              key={album.id}
              album={album}
              depth={folder.depth + 1}
              albumBasePath={albumBasePath}
              onDropOnAlbum={onDropOnAlbum}
              onAlbumContextMenu={onAlbumContextMenu}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function AlbumRow({
  album,
  depth,
  albumBasePath = '/albums',
  onDropOnAlbum,
  onAlbumContextMenu,
}: {
  album: TreeAlbum;
  depth: number;
  albumBasePath?: string;
  onDropOnAlbum?: (albumId: string, payload: DragPayload) => void;
  onAlbumContextMenu?: (album: { id: string; name: string }, event: React.MouseEvent) => void;
}) {
  const { isOver: dropTarget, dropProps } = useDropTarget({
    // "copy" reads correctly here: adding to an album leaves the photo
    // wherever it is filed.
    effect: 'copy',
    onDrop: (payload) => onDropOnAlbum?.(album.id, payload),
  });

  return (
    <li>
      <NavLink
        to={`${albumBasePath}/${album.id}`}
        style={{ paddingLeft: `${depth * 12 + 24}px` }}
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          startDrag(event, { kind: 'album', ids: [album.id], label: album.name });
        }}
        {...dropProps}
        onContextMenu={(event) => onAlbumContextMenu?.(album, event)}
        className={({ isActive }) =>
          clsx(
            'flex items-center gap-2 rounded-md py-1 pr-3.5 text-sm transition',
            isActive ? 'bg-primary-soft text-primary' : 'hover:bg-surface-sunken',
            dropTarget && 'bg-primary text-white',
          )
        }
      >
        <AlbumThumb album={album} />
        <Tooltip label={album.name} onlyWhenOverflow>
          <span className="min-w-0 flex-1 truncate">{album.name}</span>
        </Tooltip>
        <span className="shrink-0 text-[11px] tabular-nums opacity-70">{album.assetCount}</span>
      </NavLink>
    </li>
  );
}

/** Small square cover for an album inside the tree. Never a bare icon. */
function AlbumThumb({ album }: { album: TreeAlbum }) {
  const ids = album.coverAssetIds?.length
    ? album.coverAssetIds
    : album.coverAssetId
      ? [album.coverAssetId]
      : [];

  if (ids.length === 0) {
    // Colour derived from the name so an empty album still reads as itself.
    let hash = 0;
    for (let i = 0; i < album.name.length; i++) {
      hash = (hash * 31 + album.name.charCodeAt(i)) % 360;
    }
    const hue = 140 + (hash % 110);

    return (
      <span
        className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded text-[9px] font-semibold text-white/90"
        style={{
          background: `linear-gradient(140deg, oklch(72% 0.11 ${hue}), oklch(46% 0.13 ${(hue + 40) % 360}))`,
        }}
      >
        {album.name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    );
  }

  if (ids.length < 4) {
    return (
      <RetryingImage
        src={`/api/assets/${ids[0]}/thumbnail`}
        alt=""
        loading="lazy"
        draggable={false}
        className="h-[18px] w-[18px] shrink-0 rounded object-cover"
      />
    );
  }

  return (
    <span className="grid h-[18px] w-[18px] shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded">
      {ids.slice(0, 4).map((id) => (
        <RetryingImage
          key={id}
          src={`/api/assets/${id}/thumbnail`}
          alt=""
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover"
        />
      ))}
    </span>
  );
}
