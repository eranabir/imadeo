import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Download,
  FolderInput,
  FolderPlus,
  Heart,
  HeartOff,
  Info,
  LayoutGrid,
  Lock,
  Pencil,
  RotateCcw,
  ScanFace,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { DragPayload } from '../lib/dnd';
import type { Album, Asset, FolderNode } from '../types';
import {
  ConfirmDialog,
  Menu,
  PromptDialog,
  anchorFromPoint,
  type Anchor,
  type MenuItem,
} from '../ui';
import { AssignSubjectDialog } from './AssignSubjectDialog';
import { MoveDialog } from './MoveDialog';
import { VaultDialog } from './VaultGate';

type Target =
  | { kind: 'assets'; asset: Asset; ids: string[] }
  | { kind: 'folder'; folder: Pick<FolderNode, 'id' | 'name' | 'isLocked'> }
  | { kind: 'album'; album: Pick<Album, 'id' | 'name'> };

interface Options {
  onShowDetails?: (asset: Asset) => void;
  /** Trash view swaps delete for restore. */
  trashed?: boolean;
  /** Photos currently selected, so the menu can act on all of them. */
  selectedIds?: string[];
  /**
   * Extra right-click entries a page can contribute, for actions that only make
   * sense there — "not this person" on a person's page, say. Appended to the
   * standard photo menu so the shared items keep the same order everywhere.
   */
  extraAssetItems?: (asset: Asset, ids: string[]) => MenuItem[];
  onError?: (message: string) => void;
}

/**
 * Every context menu, move dialog and drop handler in the library.
 *
 * Folders, albums and photos share one hook so the same action means the same
 * thing wherever you right-click, and so a drop target only has to hand over
 * the payload it received.
 */
export function useLibraryActions({
  onShowDetails,
  trashed,
  selectedIds,
  extraAssetItems,
  onError,
}: Options = {}) {
  const queryClient = useQueryClient();

  const [target, setTarget] = useState<{ item: Target; anchor: Anchor } | null>(null);
  const [moving, setMoving] = useState<Target | null>(null);
  /** Photos whose detections are being assigned to a person or pet. */
  const [assigning, setAssigning] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [newFolderIn, setNewFolderIn] = useState<string | null>(null);
  const [newAlbumIn, setNewAlbumIn] = useState<string | null>(null);
  const [vaultPrompt, setVaultPrompt] = useState(false);
  /** Remembered so the lock can be applied straight after unlocking. */
  const [pendingLock, setPendingLock] = useState<Target | null>(null);

  const invalidate = () => queryClient.invalidateQueries();
  const fail = (e: unknown) => onError?.(errorMessage(e));
  const mutation = <T,>(fn: (input: T) => Promise<unknown>) => ({
    mutationFn: fn,
    onSuccess: invalidate,
    onError: fail,
  });

  // -- photos ---------------------------------------------------------------

  const setFavorite = useMutation(
    mutation(async ({ ids, isFavorite }: { ids: string[]; isFavorite: boolean }) =>
      api.put('/assets/bulk', { ids, isFavorite }),
    ),
  );

  const renameAsset = useMutation(
    mutation(async ({ id, name }: { id: string; name: string }) =>
      // Display name only — the file on disk keeps the name the storage
      // template gave it.
      api.put(`/assets/${id}`, { originalFileName: name }),
    ),
  );

  const setArchived = useMutation(
    mutation(async ({ ids, visibility }: { ids: string[]; visibility: 'TIMELINE' | 'ARCHIVE' }) =>
      api.put('/assets/bulk', { ids, visibility }),
    ),
  );

  const trashAssets = useMutation(
    mutation(async (ids: string[]) => api.delete('/assets', { data: { ids } })),
  );

  const restoreAssets = useMutation(
    mutation(async (ids: string[]) => api.post('/assets/trash/restore', { ids })),
  );

  const deleteAssetsForever = useMutation(
    mutation(async (ids: string[]) => api.delete('/assets', { data: { ids, force: true } })),
  );

  // -- moving ---------------------------------------------------------------

  const assetsToFolder = useMutation(
    mutation(async ({ folderId, ids }: { folderId: string | null; ids: string[] }) =>
      folderId
        ? api.put(`/folders/${folderId}/assets`, { assetIds: ids })
        : api.put('/assets/bulk', { ids, folderId: null }),
    ),
  );

  const assetsToAlbum = useMutation(
    mutation(async ({ albumId, ids }: { albumId: string; ids: string[] }) =>
      api.put(`/albums/${albumId}/assets`, { assetIds: ids }),
    ),
  );

  const folderToFolder = useMutation(
    mutation(async ({ id, parentId }: { id: string; parentId: string | null }) =>
      api.put(`/folders/${id}/move`, { parentId }),
    ),
  );

  const albumToFolder = useMutation(
    mutation(async ({ id, folderId }: { id: string; folderId: string | null }) =>
      api.put(`/albums/${id}`, { folderId }),
    ),
  );

  // -- folders and albums ---------------------------------------------------

  const renameFolder = useMutation(
    mutation(async ({ id, name }: { id: string; name: string }) => api.put(`/folders/${id}`, { name })),
  );

  const renameAlbum = useMutation(
    mutation(async ({ id, albumName }: { id: string; albumName: string }) =>
      api.put(`/albums/${id}`, { albumName }),
    ),
  );

  const createFolder = useMutation(
    mutation(async ({ name, parentId }: { name: string; parentId: string | null }) =>
      api.post('/folders', { name, parentId: parentId ?? undefined }),
    ),
  );

  const createAlbum = useMutation(
    mutation(async ({ albumName, folderId }: { albumName: string; folderId: string | null }) =>
      api.post('/albums', { albumName, folderId }),
    ),
  );

  const deleteFolder = useMutation(mutation(async (id: string) => api.delete(`/folders/${id}`)));
  const deleteAlbum = useMutation(mutation(async (id: string) => api.delete(`/albums/${id}`)));

  const setFolderLock = useMutation({
    mutationFn: async ({ id, isLocked }: { id: string; isLocked: boolean }) =>
      api.put(`/folders/${id}/lock`, { isLocked }),
    onSuccess: invalidate,
    onError: (error) => handleVaultError(error),
  });

  const setAlbumLock = useMutation({
    mutationFn: async ({ id, isLocked }: { id: string; isLocked: boolean }) =>
      api.put(`/albums/${id}/lock`, { isLocked }),
    onSuccess: invalidate,
    onError: (error) => handleVaultError(error),
  });

  /**
   * A locked vault answers with VAULT_LOCKED rather than a plain error, so ask
   * for the private password and replay the action instead of surfacing a dead end.
   */
  function handleVaultError(error: unknown) {
    const code = (error as { response?: { data?: { code?: string } } }).response?.data?.code;
    if (code === 'VAULT_LOCKED') setVaultPrompt(true);
    else fail(error);
  }

  // -- opening the menu -----------------------------------------------------

  const openMenu = useCallback((item: Target, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setTarget({ item, anchor: anchorFromPoint(event.clientX, event.clientY) });
  }, []);

  /** Right-click handler for a photo tile. */
  const onAssetContextMenu = useCallback(
    (asset: Asset, event: React.MouseEvent) => {
      const ids =
        selectedIds?.length && selectedIds.includes(asset.id) ? selectedIds : [asset.id];
      openMenu({ kind: 'assets', asset, ids }, event);
    },
    [openMenu, selectedIds],
  );

  const onFolderContextMenu = useCallback(
    (folder: Pick<FolderNode, 'id' | 'name' | 'isLocked'>, event: React.MouseEvent) =>
      openMenu({ kind: 'folder', folder }, event),
    [openMenu],
  );

  const onAlbumContextMenu = useCallback(
    (album: Pick<Album, 'id' | 'name'>, event: React.MouseEvent) =>
      openMenu({ kind: 'album', album }, event),
    [openMenu],
  );

  // -- dropping -------------------------------------------------------------

  /** Applies a dropped payload to a folder. */
  const dropOnFolder = useCallback(
    (folderId: string, payload: DragPayload) => {
      if (payload.kind === 'assets') assetsToFolder.mutate({ folderId, ids: payload.ids });
      else if (payload.kind === 'folder' && payload.ids[0] !== folderId) {
        folderToFolder.mutate({ id: payload.ids[0], parentId: folderId });
      } else if (payload.kind === 'album') {
        albumToFolder.mutate({ id: payload.ids[0], folderId });
      }
    },
    [assetsToFolder, folderToFolder, albumToFolder],
  );

  /** Only photos can be dropped onto an album. */
  const dropOnAlbum = useCallback(
    (albumId: string, payload: DragPayload) => {
      if (payload.kind === 'assets') assetsToAlbum.mutate({ albumId, ids: payload.ids });
    },
    [assetsToAlbum],
  );

  /** Dropping on the root takes the item out of whatever folder it was in. */
  const dropOnRoot = useCallback(
    (payload: DragPayload) => {
      if (payload.kind === 'assets') assetsToFolder.mutate({ folderId: null, ids: payload.ids });
      else if (payload.kind === 'folder') folderToFolder.mutate({ id: payload.ids[0], parentId: null });
      else albumToFolder.mutate({ id: payload.ids[0], folderId: null });
    },
    [assetsToFolder, folderToFolder, albumToFolder],
  );

  // -- menu contents --------------------------------------------------------

  const itemsFor = (item: Target): MenuItem[] => {
    if (item.kind === 'assets') {
      const { asset, ids } = item;
      const suffix = ids.length > 1 ? ` (${ids.length})` : '';

      if (trashed) {
        return [
          {
            id: 'restore',
            label: 'Restore' + suffix,
            icon: <RotateCcw size={15} />,
            onSelect: () => restoreAssets.mutate(ids),
          },
          {
            id: 'delete',
            label: 'Delete permanently',
            icon: <Trash2 size={15} />,
            danger: true,
            separated: true,
            onSelect: () => deleteAssetsForever.mutate(ids),
          },
        ];
      }

      return [
        {
          id: 'favorite',
          label: (asset.isFavorite ? 'Remove from favorites' : 'Add to favorites') + suffix,
          icon: asset.isFavorite ? <HeartOff size={15} /> : <Heart size={15} />,
          onSelect: () => setFavorite.mutate({ ids, isFavorite: !asset.isFavorite }),
        },
        {
          id: 'rename',
          label: 'Rename',
          icon: <Pencil size={15} />,
          // One name for one photo; renaming a selection would need a pattern,
          // which is a different feature.
          disabled: ids.length > 1,
          onSelect: () => setRenaming(item),
        },
        {
          id: 'assign',
          label: ids.length > 1 ? `Who is in these ${ids.length}?` : 'Who is this?',
          icon: <ScanFace size={15} />,
          hint: 'Link to a person or pet',
          onSelect: () => setAssigning(ids),
        },
        {
          id: 'move',
          label: 'Move to…',
          icon: <FolderInput size={15} />,
          hint: 'A folder or an album',
          separated: true,
          onSelect: () => setMoving(item),
        },
        {
          id: 'archive',
          label: (asset.visibility === 'ARCHIVE' ? 'Move back to timeline' : 'Archive') + suffix,
          icon: <Archive size={15} />,
          separated: true,
          onSelect: () =>
            setArchived.mutate({
              ids,
              visibility: asset.visibility === 'ARCHIVE' ? 'TIMELINE' : 'ARCHIVE',
            }),
        },
        {
          id: 'download',
          label: 'Download' + suffix,
          icon: <Download size={15} />,
          onSelect: () => {
            window.location.href =
              ids.length > 1
                ? `/api/assets/download/archive?ids=${ids.join(',')}`
                : `/api/assets/${asset.id}/download`;
          },
        },
        ...(onShowDetails
          ? [
              {
                id: 'details',
                label: 'Details',
                icon: <Info size={15} />,
                onSelect: () => onShowDetails(asset),
              },
            ]
          : []),
        ...(extraAssetItems?.(asset, ids) ?? []),
        {
          id: 'trash',
          label: 'Move to trash' + suffix,
          icon: <Trash2 size={15} />,
          danger: true,
          separated: true,
          onSelect: () => trashAssets.mutate(ids),
        },
      ];
    }

    if (item.kind === 'folder') {
      return [
        {
          id: 'rename',
          label: 'Rename',
          icon: <Pencil size={15} />,
          onSelect: () => setRenaming(item),
        },
        {
          id: 'move',
          label: 'Move to…',
          icon: <FolderInput size={15} />,
          hint: 'Another folder',
          onSelect: () => setMoving(item),
        },
        {
          id: 'new-folder',
          label: 'New folder',
          icon: <FolderPlus size={15} />,
          hint: `Inside “${item.folder.name}”`,
          separated: true,
          onSelect: () => setNewFolderIn(item.folder.id),
        },
        {
          id: 'new-album',
          label: 'New album',
          icon: <LayoutGrid size={15} />,
          hint: `Inside “${item.folder.name}”`,
          onSelect: () => setNewAlbumIn(item.folder.id),
        },
        {
          id: 'lock',
          label: item.folder.isLocked ? 'Unlock' : 'Lock',
          icon: item.folder.isLocked ? <Unlock size={15} /> : <Lock size={15} />,
          hint: item.folder.isLocked ? undefined : 'Hidden from timeline, search and shares',
          onSelect: () => {
            setPendingLock(item);
            setFolderLock.mutate({ id: item.folder.id, isLocked: !item.folder.isLocked });
          },
        },
        {
          id: 'delete',
          label: 'Delete folder',
          icon: <Trash2 size={15} />,
          danger: true,
          separated: true,
          onSelect: () => setDeleting(item),
        },
      ];
    }

    const locked = 'isLocked' in item.album && (item.album as { isLocked?: boolean }).isLocked;

    return [
      {
        id: 'rename',
        label: 'Rename',
        icon: <Pencil size={15} />,
        onSelect: () => setRenaming(item),
      },
      {
        id: 'move',
        label: 'Move to…',
        icon: <FolderInput size={15} />,
        hint: 'A folder',
        onSelect: () => setMoving(item),
      },
      {
        id: 'lock',
        label: locked ? 'Unlock' : 'Lock',
        icon: locked ? <Unlock size={15} /> : <Lock size={15} />,
        hint: locked ? undefined : 'Also revokes any sharing',
        separated: true,
        onSelect: () => {
          setPendingLock(item);
          setAlbumLock.mutate({ id: item.album.id, isLocked: !locked });
        },
      },
      {
        id: 'delete',
        label: 'Delete album',
        icon: <Trash2 size={15} />,
        danger: true,
        separated: true,
        onSelect: () => setDeleting(item),
      },
    ];
  };

  const labelOf = (item: Target | null) =>
    !item
      ? ''
      : item.kind === 'assets'
        ? item.ids.length > 1
          ? `${item.ids.length} photos`
          : item.asset.originalFileName
        : item.kind === 'folder'
          ? item.folder.name
          : item.album.name;

  const overlays = (
    <>
      <AssignSubjectDialog
        open={assigning !== null}
        assetIds={assigning ?? []}
        onClose={() => setAssigning(null)}
        onError={onError}
      />
      {target && (
        <Menu
          anchor={target.anchor}
          items={itemsFor(target.item)}
          onDismiss={() => setTarget(null)}
          header={
            <p className="truncate text-xs font-medium text-content-muted">
              {labelOf(target.item)}
            </p>
          }
        />
      )}

      <MoveDialog
        open={Boolean(moving)}
        count={moving?.kind === 'assets' ? moving.ids.length : 1}
        title={
          moving?.kind === 'folder'
            ? `Move “${moving.folder.name}”`
            : moving?.kind === 'album'
              ? `Move “${moving.album.name}”`
              : undefined
        }
        // A folder or an album can only be filed under a folder.
        allowAlbums={moving?.kind === 'assets'}
        excludeFolderId={moving?.kind === 'folder' ? moving.folder.id : undefined}
        onClose={() => setMoving(null)}
        onMoveToFolder={(folderId) => {
          if (!moving) return;
          if (moving.kind === 'assets') assetsToFolder.mutate({ folderId, ids: moving.ids });
          else if (moving.kind === 'folder')
            folderToFolder.mutate({ id: moving.folder.id, parentId: folderId });
          else albumToFolder.mutate({ id: moving.album.id, folderId });
        }}
        onAddToAlbum={(albumId) => {
          if (moving?.kind === 'assets') assetsToAlbum.mutate({ albumId, ids: moving.ids });
        }}
      />

      <PromptDialog
        open={Boolean(renaming)}
        title={
          renaming?.kind === 'folder'
            ? 'Rename folder'
            : renaming?.kind === 'album'
              ? 'Rename album'
              : 'Rename photo'
        }
        label="Name"
        initialValue={labelOf(renaming)}
        confirmLabel="Rename"
        onSubmit={(name) => {
          if (renaming?.kind === 'folder') renameFolder.mutate({ id: renaming.folder.id, name });
          else if (renaming?.kind === 'album')
            renameAlbum.mutate({ id: renaming.album.id, albumName: name });
          else if (renaming?.kind === 'assets')
            renameAsset.mutate({ id: renaming.asset.id, name });
        }}
        onClose={() => setRenaming(null)}
      />

      <PromptDialog
        open={Boolean(newFolderIn)}
        title="New folder"
        label="Folder name"
        placeholder="Holidays"
        onSubmit={(name) => createFolder.mutate({ name, parentId: newFolderIn })}
        onClose={() => setNewFolderIn(null)}
      />

      <PromptDialog
        open={Boolean(newAlbumIn)}
        title="New album"
        description="Albums group photos without moving them out of their folders."
        label="Album name"
        placeholder="Best of the trip"
        onSubmit={(albumName) => createAlbum.mutate({ albumName, folderId: newAlbumIn })}
        onClose={() => setNewAlbumIn(null)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete “${labelOf(deleting)}”?`}
        description={
          deleting?.kind === 'folder'
            ? 'Sub-folders go with it and the photos inside move to the trash, where you can restore them for 30 days.'
            : 'The album is removed. The photos inside it stay in your library.'
        }
        confirmLabel={deleting?.kind === 'folder' ? 'Delete folder' : 'Delete album'}
        destructive
        onConfirm={() => {
          if (deleting?.kind === 'folder') deleteFolder.mutate(deleting.folder.id);
          else if (deleting?.kind === 'album') deleteAlbum.mutate(deleting.album.id);
        }}
        onClose={() => setDeleting(null)}
      />

      <VaultDialog
        open={vaultPrompt}
        onClose={() => {
          setVaultPrompt(false);
          setPendingLock(null);
        }}
        onUnlocked={() => {
          // Replay whatever the locked vault refused.
          if (pendingLock?.kind === 'folder') {
            setFolderLock.mutate({
              id: pendingLock.folder.id,
              isLocked: !pendingLock.folder.isLocked,
            });
          } else if (pendingLock?.kind === 'album') {
            const locked = (pendingLock.album as { isLocked?: boolean }).isLocked;
            setAlbumLock.mutate({ id: pendingLock.album.id, isLocked: !locked });
          }
          setPendingLock(null);
        }}
      />
    </>
  );

  return {
    overlays,
    onAssetContextMenu,
    onFolderContextMenu,
    onAlbumContextMenu,
    dropOnFolder,
    dropOnAlbum,
    dropOnRoot,
  };
}
