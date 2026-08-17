import clsx from 'clsx';
import { FolderOpen, Heart, Image, LayoutGrid, Lock, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { mediaUrl } from '../lib/api';
import { startDrag, type DragPayload } from '../lib/dnd';
import { formatBytes, formatDate } from '../lib/format';
import { useDropTarget } from '../lib/useDropTarget';
import type { Album, Asset, FolderNode } from '../types';
import { SelectionCheck, Tooltip } from '../ui';
import { AlbumCover } from './AlbumCover';
import { RetryingImage } from './RetryingImage';
import { VirtualGrid } from './VirtualGrid';

type FolderListItem =
  | { kind: 'folder'; value: FolderNode }
  | { kind: 'album'; value: Album }
  | { kind: 'asset'; value: Asset };

interface Props {
  folders: FolderNode[];
  albums: Album[];
  assets: Asset[];
  folderBasePath: string;
  albumBasePath: string;
  selected: Set<string>;
  onOpenAsset: (asset: Asset) => void;
  onToggleAsset: (asset: Asset) => void;
  onSelectRange: (asset: Asset) => void;
  onAnchorAsset: (asset: Asset) => void;
  onDropFolder: (folderId: string, payload: DragPayload) => void;
  onDropAlbum: (albumId: string, payload: DragPayload) => void;
  onFolderContextMenu: (folder: FolderNode, event: React.MouseEvent) => void;
  onAlbumContextMenu: (album: Album, event: React.MouseEvent) => void;
  onAssetContextMenu: (asset: Asset, event: React.MouseEvent) => void;
}

const rowGrid =
  'grid h-full grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 px-3 sm:grid-cols-[minmax(0,1fr)_5.5rem_8rem] lg:grid-cols-[minmax(0,1fr)_5.5rem_8rem_8rem]';

export function FolderContentsList({
  folders,
  albums,
  assets,
  folderBasePath,
  albumBasePath,
  selected,
  onOpenAsset,
  onToggleAsset,
  onSelectRange,
  onAnchorAsset,
  onDropFolder,
  onDropAlbum,
  onFolderContextMenu,
  onAlbumContextMenu,
  onAssetContextMenu,
}: Props) {
  const items: FolderListItem[] = [
    ...folders.map((value): FolderListItem => ({ kind: 'folder', value })),
    ...albums.map((value): FolderListItem => ({ kind: 'album', value })),
    ...assets.map((value): FolderListItem => ({ kind: 'asset', value })),
  ];

  return (
    <section className="mb-7 overflow-hidden rounded-panel border border-border-subtle bg-surface-raised">
      <div
        className={clsx(
          rowGrid,
          'h-9 border-b border-border-subtle bg-surface-sunken text-[11px] font-semibold uppercase tracking-wider text-content-muted',
        )}
      >
        <span>Name</span>
        <span>Type</span>
        <span className="hidden sm:block">Details</span>
        <span className="hidden lg:block">Date</span>
      </div>
      <VirtualGrid
        items={items}
        getKey={(item) => `${item.kind}-${item.value.id}`}
        minItemWidth={200}
        columnCount={1}
        itemHeight={64}
        gap={0}
        renderItem={(item) => {
          if (item.kind === 'folder') {
            return (
              <FolderListRow
                folder={item.value}
                basePath={folderBasePath}
                onDrop={onDropFolder}
                onContextMenu={onFolderContextMenu}
              />
            );
          }
          if (item.kind === 'album') {
            return (
              <AlbumListRow
                album={item.value}
                basePath={albumBasePath}
                onDrop={onDropAlbum}
                onContextMenu={onAlbumContextMenu}
              />
            );
          }
          return (
            <AssetListRow
              asset={item.value}
              selected={selected}
              onOpen={onOpenAsset}
              onToggle={onToggleAsset}
              onSelectRange={onSelectRange}
              onAnchor={onAnchorAsset}
              onContextMenu={onAssetContextMenu}
            />
          );
        }}
      />
    </section>
  );
}

function FolderListRow({
  folder,
  basePath,
  onDrop,
  onContextMenu,
}: {
  folder: FolderNode;
  basePath: string;
  onDrop: (folderId: string, payload: DragPayload) => void;
  onContextMenu: (folder: FolderNode, event: React.MouseEvent) => void;
}) {
  const { isOver, dropProps } = useDropTarget({
    effect: 'move',
    onDrop: (payload) => onDrop(folder.id, payload),
  });
  const details = [
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
        rowGrid,
        'border-b border-border-subtle transition last:border-b-0 hover:bg-surface-sunken',
        isOver && 'bg-primary/15 ring-2 ring-inset ring-primary/40',
      )}
    >
      <NameCell
        icon={folder.isLocked ? <Lock size={18} /> : <FolderOpen size={18} />}
        iconClassName={folder.isLocked ? 'text-content-muted' : 'text-nav-folders'}
        name={folder.name}
        mobileMeta={details}
      />
      <span className="text-xs text-content-muted">Folder</span>
      <span className="hidden truncate text-xs text-content-muted sm:block">{details}</span>
      <span className="hidden text-xs text-content-muted lg:block">—</span>
    </Link>
  );
}

function AlbumListRow({
  album,
  basePath,
  onDrop,
  onContextMenu,
}: {
  album: Album;
  basePath: string;
  onDrop: (albumId: string, payload: DragPayload) => void;
  onContextMenu: (album: Album, event: React.MouseEvent) => void;
}) {
  const { isOver, dropProps } = useDropTarget({
    effect: 'copy',
    onDrop: (payload) => onDrop(album.id, payload),
  });

  return (
    <Link
      to={`${basePath}/${album.id}`}
      draggable
      onDragStart={(event) =>
        startDrag(event, { kind: 'album', ids: [album.id], label: album.name })
      }
      {...dropProps}
      onContextMenu={(event) => onContextMenu(album, event)}
      className={clsx(
        rowGrid,
        'border-b border-border-subtle transition last:border-b-0 hover:bg-surface-sunken',
        isOver && 'bg-primary/15 ring-2 ring-inset ring-primary/40',
      )}
    >
      <NameCell
        image={<AlbumCover album={album} />}
        name={album.name}
        mobileMeta={`${album.assetCount} items`}
      />
      <span className="flex items-center gap-1.5 text-xs text-content-muted">
        <LayoutGrid size={13} /> Album
      </span>
      <span className="hidden text-xs text-content-muted sm:block">{album.assetCount} items</span>
      <span className="hidden text-xs text-content-muted lg:block">
        {formatDate(album.createdAt)}
      </span>
    </Link>
  );
}

function AssetListRow({
  asset,
  selected,
  onOpen,
  onToggle,
  onSelectRange,
  onAnchor,
  onContextMenu,
}: {
  asset: Asset;
  selected: Set<string>;
  onOpen: (asset: Asset) => void;
  onToggle: (asset: Asset) => void;
  onSelectRange: (asset: Asset) => void;
  onAnchor: (asset: Asset) => void;
  onContextMenu: (asset: Asset, event: React.MouseEvent) => void;
}) {
  const isSelected = selected.has(asset.id);
  const selecting = selected.size > 0;

  const openOrSelect = (event: React.MouseEvent) => {
    if (event.shiftKey) onSelectRange(asset);
    else if (event.metaKey || event.ctrlKey || selecting) onToggle(asset);
    else {
      onAnchor(asset);
      onOpen(asset);
    }
  };

  return (
    <div
      draggable
      onDragStart={(event) => {
        const ids = isSelected && selected.size > 0 ? [...selected] : [asset.id];
        startDrag(
          event,
          { kind: 'assets', ids, label: asset.originalFileName },
          { image: event.currentTarget.querySelector('img'), count: ids.length },
        );
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(asset, event);
      }}
      className={clsx(
        rowGrid,
        'border-b border-border-subtle transition last:border-b-0 hover:bg-surface-sunken',
        isSelected && 'bg-primary/10',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span onClick={(event) => event.stopPropagation()}>
          <SelectionCheck
            checked={isSelected}
            onChange={() => onToggle(asset)}
            label={
              isSelected
                ? `Deselect ${asset.originalFileName}`
                : `Select ${asset.originalFileName}`
            }
          />
        </span>
        <button
          type="button"
          onClick={openOrSelect}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
            <RetryingImage
              src={mediaUrl(asset.id, 'thumbnail')}
              assetId={asset.id}
              thumbnailReady={Boolean(asset.thumbnailPath)}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full object-cover"
            />
            {asset.type === 'VIDEO' && (
              <Play
                size={12}
                fill="currentColor"
                className="absolute bottom-1 right-1 text-white drop-shadow"
              />
            )}
          </span>
          <span className="min-w-0">
            <Tooltip label={asset.originalFileName} onlyWhenOverflow>
              <span className="block truncate text-sm font-medium">{asset.originalFileName}</span>
            </Tooltip>
            <span className="block truncate text-xs text-content-muted sm:hidden">
              {formatBytes(asset.fileSizeInByte)}
            </span>
          </span>
          {asset.isFavorite && (
            <Heart size={14} fill="currentColor" className="shrink-0 text-primary" />
          )}
        </button>
      </div>
      <span className="flex items-center gap-1.5 text-xs text-content-muted">
        {asset.type === 'VIDEO' ? <Play size={13} /> : <Image size={13} />}
        {asset.type === 'VIDEO' ? 'Video' : 'Photo'}
      </span>
      <span className="hidden text-xs text-content-muted sm:block">
        {formatBytes(asset.fileSizeInByte)}
      </span>
      <span className="hidden text-xs text-content-muted lg:block">
        {formatDate(asset.localDateTime)}
      </span>
    </div>
  );
}

function NameCell({
  icon,
  iconClassName,
  image,
  name,
  mobileMeta,
}: {
  icon?: React.ReactNode;
  iconClassName?: string;
  image?: React.ReactNode;
  name: string;
  mobileMeta: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        className={clsx(
          'grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-control bg-surface-sunken',
          iconClassName,
        )}
      >
        {image ?? icon}
      </span>
      <span className="min-w-0">
        <Tooltip label={name} onlyWhenOverflow>
          <span className="block truncate text-sm font-medium">{name}</span>
        </Tooltip>
        <span className="block truncate text-xs text-content-muted sm:hidden">{mobileMeta}</span>
      </span>
    </span>
  );
}
