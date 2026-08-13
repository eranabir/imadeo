import clsx from 'clsx';
import { FolderOpen, Lock, MoreVertical } from 'lucide-react';
import { Link } from 'react-router-dom';
import { startDrag, type DragPayload } from '../lib/dnd';
import { useDropTarget } from '../lib/useDropTarget';
import type { Album, FolderNode } from '../types';
import { IconButton, Tooltip } from '../ui';
import { AlbumCover } from './AlbumCover';

/**
 * Folder and album cards.
 *
 * They are components rather than inline JSX so each one can own its own drop
 * state via `useDropTarget` — a hook cannot be called inside a `.map`, and a
 * single shared "which card is hovered" flag was what limited the drop zone to
 * the part of the card with no children in it.
 */

interface FolderCardProps {
  folder: FolderNode;
  basePath?: string;
  onDrop: (folderId: string, payload: DragPayload) => void;
  onContextMenu: (
    folder: Pick<FolderNode, 'id' | 'name' | 'isLocked'>,
    event: React.MouseEvent,
  ) => void;
}

export function FolderCard({ folder, basePath = '/folders', onDrop, onContextMenu }: FolderCardProps) {
  const { isOver, dropProps } = useDropTarget({
    effect: 'move',
    onDrop: (payload) => onDrop(folder.id, payload),
  });

  const summary = [
    folder.childCount ? `${folder.childCount} folders` : null,
    folder.albumCount ? `${folder.albumCount} albums` : null,
    `${folder.assetCount ?? 0} items`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link
      to={`${basePath}/${folder.id}`}
      draggable
      onDragStart={(event) =>
        startDrag(event, { kind: 'folder', ids: [folder.id], label: folder.name })
      }
      {...dropProps}
      onContextMenu={(event) => onContextMenu(folder, event)}
      className={clsx(
        'flex h-full min-h-0 items-center gap-3 overflow-hidden rounded-panel border px-3.5 py-3 transition',
        isOver
          ? 'border-primary bg-primary/15 ring-2 ring-primary/40'
          : 'border-border-subtle bg-surface-raised hover:border-primary hover:bg-surface-sunken',
      )}
    >
      {folder.isLocked ? (
        <Lock size={18} className="pointer-events-none shrink-0 text-content-muted" />
      ) : (
        <FolderOpen size={18} className="pointer-events-none shrink-0 text-nav-folders" />
      )}
      <span className="min-w-0 flex-1">
        <Tooltip label={folder.name} onlyWhenOverflow>
          <span className="block truncate text-sm font-medium">{folder.name}</span>
        </Tooltip>
        <Tooltip label={summary} onlyWhenOverflow>
          <span className="block truncate text-xs text-content-muted">{summary}</span>
        </Tooltip>
      </span>
    </Link>
  );
}

interface AlbumCardProps {
  album: Album;
  basePath?: string;
  onDrop: (albumId: string, payload: DragPayload) => void;
  onContextMenu: (album: Pick<Album, 'id' | 'name'>, event: React.MouseEvent) => void;
  /** Extra line under the title, e.g. the folder it is filed in. */
  meta?: React.ReactNode;
  /** Shows the ⋮ button on hover; the Albums page uses it. */
  withMenuButton?: boolean;
}

export function AlbumCard({
  album,
  basePath = '/albums',
  onDrop,
  onContextMenu,
  meta,
  withMenuButton,
}: AlbumCardProps) {
  const { isOver, dropProps } = useDropTarget({
    // Adding to an album leaves the photo filed where it is.
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
        'group relative overflow-hidden rounded-panel border bg-surface-raised transition',
        isOver
          ? 'border-primary ring-2 ring-primary/50'
          : 'border-border-subtle hover:border-primary',
      )}
    >
      {/* The link fills the card but ignores pointer events during a drag, so
          the drop target is the whole box rather than the strip below it. */}
      <Link to={`${basePath}/${album.id}`} className="block">
        <span className="block aspect-[4/3] overflow-hidden bg-surface-sunken">
          <AlbumCover album={album} />
        </span>

        <span className="block px-3 py-2.5">
          <Tooltip label={album.name} onlyWhenOverflow>
            <span className="block truncate text-sm font-medium">{album.name}</span>
          </Tooltip>
          <span className="mt-0.5 block truncate text-xs text-content-muted">
            {meta ?? `${album.assetCount} items`}
          </span>
        </span>
      </Link>

      {isOver && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-primary/25">
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white shadow">
            Add to “{album.name}”
          </span>
        </span>
      )}

      {withMenuButton && (
        <div className="absolute right-2 top-2 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            label="Album options"
            size="sm"
            className="bg-black/55 text-white hover:bg-black/75"
            onClick={(event) => {
              event.preventDefault();
              onContextMenu(album, event);
            }}
          >
            <MoreVertical size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
