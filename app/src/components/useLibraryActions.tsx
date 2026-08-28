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
  Share2,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { DragPayload } from '../lib/dnd';
import { runBatchedOperation, runOperation } from '../lib/operationProgress';
import { useAuth } from '../store/auth';
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
import { AssetShareDialog } from './AssetShareDialog';
import { FolderShareDialog } from './FolderShareDialog';
import { MoveDialog } from './MoveDialog';
import { ShareDialog } from './ShareDialog';
import { VaultDialog } from './VaultGate';

type FolderActionTarget = Pick<FolderNode, 'id' | 'name' | 'isLocked' | 'shared'> &
  Partial<Pick<FolderNode, 'assetCount' | 'albumCount' | 'childCount' | 'children'>>;

type Target =
  | { kind: 'assets'; asset: Asset; ids: string[] }
  | { kind: 'folder'; folder: FolderActionTarget }
  | { kind: 'album'; album: Pick<Album, 'id' | 'name'> };

interface Options {
  onShowDetails?: (asset: Asset) => void;
  /** Trash view swaps delete for restore. */
  trashed?: boolean;
  /** Photos currently selected, so the menu can act on all of them. */
  selectedIds?: string[];
  /**
   * Extra right-click entries a page can contribute, for actions that only make
   * sense there — “not this person” on a subject page, say. Appended to the
   * standard photo menu so the shared items keep the same order everywhere.
   */
  extraAssetItems?: (asset: Asset, ids: string[]) => MenuItem[];
  /** Exact detections represented by selected media on a subject detail page. */
  assignmentFaceIds?: (assetIds: string[]) => string[];
  onError?: (message: string) => void;
  onFolderConverted?: (album: Album) => void;
  /** Clears page-owned selection after a menu or move action succeeds. */
  onAfterChange?: () => void;
}

/** Split the final extension from a display name without treating `.hidden` as an extension. */
export function splitFileName(name: string) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { base: name, extension: '' };
  return { base: name.slice(0, dot), extension: name.slice(dot) };
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
  assignmentFaceIds,
  onError,
  onFolderConverted,
  onAfterChange,
}: Options = {}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [target, setTarget] = useState<{ item: Target; anchor: Anchor } | null>(null);
  const [moving, setMoving] = useState<Target | null>(null);
  /** Photos whose detections are being assigned to a person or pet. */
  const [assigning, setAssigning] = useState<string[] | null>(null);
  const [sharing, setSharing] = useState<string[] | null>(null);
  const [sharingFolder, setSharingFolder] = useState<Extract<Target, { kind: 'folder' }> | null>(null);
  const [sharingAlbum, setSharingAlbum] = useState<Extract<Target, { kind: 'album' }> | null>(null);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [convertingFolder, setConvertingFolder] = useState<Extract<Target, { kind: 'folder' }> | null>(
    null,
  );
  const [trashingAssets, setTrashingAssets] = useState<string[] | null>(null);
  const [permanentlyDeletingAssets, setPermanentlyDeletingAssets] = useState<string[] | null>(null);
  const [newFolderIn, setNewFolderIn] = useState<string | null>(null);
  const [newAlbumIn, setNewAlbumIn] = useState<string | null>(null);
  const [vaultPrompt, setVaultPrompt] = useState(false);
  /** Remembered so the lock can be applied straight after unlocking. */
  const [pendingLock, setPendingLock] = useState<Target | null>(null);

  const invalidate = () => {
    onAfterChange?.();
    return queryClient.invalidateQueries();
  };
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

  const setAssetLock = useMutation({
    mutationFn: async ({ ids, isLocked }: { ids: string[]; isLocked: boolean }) =>
      api.put('/assets/lock', { ids, isLocked }),
    onSuccess: () => {
      setPendingLock(null);
      void invalidate();
    },
    onError: (error) => handleVaultError(error),
  });

  const trashAssets = useMutation(
    mutation(async (ids: string[]) =>
      runBatchedOperation(
        ids.length === 1 ? 'Moving photo to Trash' : `Moving ${ids.length} photos to Trash`,
        ids,
        (batch) => api.delete('/assets', { data: { ids: batch } }),
      ),
    ),
  );

  const sharedAssetsSelected =
    trashingAssets !== null &&
    target?.item.kind === 'assets' &&
    target.item.asset.ownerId !== user?.id;

  const restoreAssets = useMutation(
    mutation(async (ids: string[]) =>
      runBatchedOperation(
        ids.length === 1 ? 'Restoring photo' : `Restoring ${ids.length} photos`,
        ids,
        (batch) => api.post('/assets/trash/restore', { ids: batch }),
      ),
    ),
  );

  const deleteAssetsForever = useMutation(
    mutation(async (ids: string[]) =>
      runBatchedOperation(
        ids.length === 1 ? 'Deleting photo permanently' : `Deleting ${ids.length} photos permanently`,
        ids,
        (batch) => api.delete('/assets', { data: { ids: batch, force: true } }),
      ),
    ),
  );

  // -- moving ---------------------------------------------------------------

  const assetsToFolder = useMutation(
    mutation(async ({ folderId, ids }: { folderId: string | null; ids: string[] }) =>
      runBatchedOperation(
        ids.length === 1 ? 'Moving photo' : `Moving ${ids.length} photos`,
        ids,
        async (batch) => {
          if (folderId) await api.put(`/folders/${folderId}/assets`, { assetIds: batch });
          else await api.put('/assets/bulk', { ids: batch, folderId: null });
        },
      ),
    ),
  );

  const assetsToAlbum = useMutation(
    mutation(async ({ albumId, ids, move }: { albumId: string; ids: string[]; move?: boolean }) =>
      runBatchedOperation(
        move
          ? ids.length === 1
            ? 'Moving photo to album'
            : `Moving ${ids.length} photos to album`
          : ids.length === 1
            ? 'Adding photo to album'
            : `Adding ${ids.length} photos to album`,
        ids,
        (batch) =>
          api.put(`/albums/${albumId}/assets`, {
            assetIds: batch,
            removeFromFolder: Boolean(move),
          }),
      ),
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

  const deleteFolder = useMutation(
    mutation(async (folder: FolderActionTarget) =>
      runOperation(`Moving “${folder.name}” to Trash`, () => api.delete(`/folders/${folder.id}`)),
    ),
  );
  const deleteAlbum = useMutation(
    mutation(async (album: Pick<Album, 'id' | 'name'>) =>
      runOperation(`Moving “${album.name}” to Trash`, () => api.delete(`/albums/${album.id}`)),
    ),
  );

  const convertFolder = useMutation({
    mutationFn: async (folder: FolderActionTarget) =>
      runOperation(
        `Converting “${folder.name}” to an album`,
        async () => (await api.post<Album>(`/folders/${folder.id}/convert-to-album`)).data,
      ),
    onSuccess: (album) => {
      setConvertingFolder(null);
      void invalidate();
      onFolderConverted?.(album);
    },
    onError: fail,
  });

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
    (folder: FolderActionTarget, event: React.MouseEvent) =>
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
      if (payload.kind === 'assets')
        assetsToAlbum.mutate({ albumId, ids: payload.ids, move: false });
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
      const locked = asset.visibility === 'LOCKED';

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
            onSelect: () => setPermanentlyDeletingAssets(ids),
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
        ...(!locked
          ? [
              {
                id: 'share',
                label: 'Share privately' + suffix,
                icon: <Share2 size={15} />,
                hint: 'Choose accounts on this server',
                onSelect: () => setSharing(ids),
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
            ]
          : []),
        ...(asset.ownerId === user?.id
          ? [
              {
                id: 'lock',
                label: (locked ? 'Unlock' : 'Lock') + suffix,
                icon: locked ? <Unlock size={15} /> : <Lock size={15} />,
                hint: locked ? undefined : 'Hidden from photos, search and shares',
                separated: true,
                onSelect: () => {
                  setPendingLock(item);
                  setAssetLock.mutate({ ids, isLocked: !locked });
                },
              },
            ]
          : []),
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
          onSelect: () => setTrashingAssets(ids),
        },
      ];
    }

    if (item.kind === 'folder') {
      if (item.folder.shared) return [];
      const canConvert =
        (item.folder.assetCount ?? 0) > 0 &&
        (item.folder.albumCount ?? 0) === 0 &&
        (item.folder.childCount ?? item.folder.children?.length ?? 0) === 0;
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
        ...(canConvert
          ? [
              {
                id: 'convert-to-album',
                label: 'Convert to album',
                icon: <LayoutGrid size={15} />,
                hint: 'Replace this folder with an album',
                onSelect: () => setConvertingFolder(item),
              },
            ]
          : []),
        {
          id: 'share',
          label: 'Share',
          icon: <Share2 size={15} />,
          hint: 'Choose accounts on this server',
          onSelect: () => setSharingFolder(item),
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
        id: 'share',
        label: 'Share',
        icon: <Share2 size={15} />,
        hint: 'Invite people or create a link',
        onSelect: () => setSharingAlbum(item),
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

  const renamedFile =
    renaming?.kind === 'assets' ? splitFileName(renaming.asset.originalFileName) : null;

  const overlays = (
    <>
      <AssignSubjectDialog
        open={assigning !== null}
        assetIds={assigning ?? []}
        faceIds={assigning ? assignmentFaceIds?.(assigning) : undefined}
        onClose={() => setAssigning(null)}
        onError={onError}
      />
      <AssetShareDialog
        open={sharing !== null}
        assetIds={sharing ?? []}
        onClose={() => setSharing(null)}
      />
      <FolderShareDialog
        open={sharingFolder !== null}
        folderId={sharingFolder?.folder.id ?? ''}
        folderName={sharingFolder?.folder.name ?? ''}
        onClose={() => setSharingFolder(null)}
      />
      <ShareDialog
        open={sharingAlbum !== null}
        album={sharingAlbum?.album ?? { id: '', name: '' }}
        onClose={() => setSharingAlbum(null)}
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
        onMoveToAlbum={(albumId) => {
          if (moving?.kind === 'assets')
            assetsToAlbum.mutate({ albumId, ids: moving.ids, move: true });
        }}
      />

      <PromptDialog
        open={Boolean(renaming)}
        title={
          renaming?.kind === 'folder'
            ? 'Rename folder'
            : renaming?.kind === 'album'
              ? 'Rename album'
              : 'Rename file'
        }
        label={renamedFile ? 'File name' : 'Name'}
        hint={renamedFile?.extension ? `The ${renamedFile.extension} extension stays unchanged.` : undefined}
        initialValue={renamedFile?.base ?? labelOf(renaming)}
        confirmLabel="Rename"
        onSubmit={(name) => {
          if (renaming?.kind === 'folder') renameFolder.mutate({ id: renaming.folder.id, name });
          else if (renaming?.kind === 'album')
            renameAlbum.mutate({ id: renaming.album.id, albumName: name });
          else if (renaming?.kind === 'assets')
            renameAsset.mutate({ id: renaming.asset.id, name: name + (renamedFile?.extension ?? '') });
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
        open={trashingAssets !== null}
        title={sharedAssetsSelected
          ? 'Remove shared photos from your library?'
          : trashingAssets?.length === 1
            ? 'Move this photo to trash?'
            : `Move these ${trashingAssets?.length ?? 0} photos to trash?`}
        description={sharedAssetsSelected
          ? "Shared photos will disappear from your library without deleting the owners' copies. Your own photos will move to Trash."
          : trashingAssets?.length === 1
            ? 'You can restore it from Trash for 30 days.'
            : 'You can restore them from Trash for 30 days.'}
        confirmLabel={sharedAssetsSelected ? 'Remove from library' : 'Move to trash'}
        destructive
        onConfirm={() => trashingAssets && trashAssets.mutate(trashingAssets)}
        onClose={() => setTrashingAssets(null)}
      />

      <ConfirmDialog
        open={permanentlyDeletingAssets !== null}
        title={
          permanentlyDeletingAssets?.length === 1
            ? 'Permanently delete this item?'
            : `Permanently delete these ${permanentlyDeletingAssets?.length ?? 0} items?`
        }
        description="The files are removed from disk. This cannot be undone."
        confirmLabel="Delete forever"
        destructive
        onConfirm={() =>
          permanentlyDeletingAssets && deleteAssetsForever.mutate(permanentlyDeletingAssets)
        }
        onClose={() => setPermanentlyDeletingAssets(null)}
      />

      <ConfirmDialog
        open={convertingFolder !== null}
        title={`Convert “${convertingFolder?.folder.name ?? ''}” to an album?`}
        description="The folder will be replaced by an album in the same location. Its photos will appear only inside the album."
        confirmLabel="Convert to album"
        onConfirm={() => convertingFolder && convertFolder.mutate(convertingFolder.folder)}
        onClose={() => setConvertingFolder(null)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete “${labelOf(deleting)}”?`}
        description={
          deleting?.kind === 'folder'
            ? 'The folder, its sub-folders, albums and photos move to Trash and can be restored together for 30 days.'
            : 'The album and its photos move to Trash and can be restored together for 30 days.'
        }
        confirmLabel={deleting?.kind === 'folder' ? 'Delete folder' : 'Delete album'}
        destructive
        onConfirm={() => {
          if (deleting?.kind === 'folder') deleteFolder.mutate(deleting.folder);
          else if (deleting?.kind === 'album') deleteAlbum.mutate(deleting.album);
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
          } else if (pendingLock?.kind === 'assets') {
            setAssetLock.mutate({
              ids: pendingLock.ids,
              isLocked: pendingLock.asset.visibility !== 'LOCKED',
            });
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
    moveAssets: (asset: Asset, ids: string[]) =>
      setMoving({ kind: 'assets', asset, ids }),
    onConvertFolder: (folder: Pick<FolderNode, 'id' | 'name' | 'isLocked' | 'shared'>) =>
      setConvertingFolder({ kind: 'folder', folder }),
  };
}
