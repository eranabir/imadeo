export type AssetLocationKind =
  | 'folder'
  | 'album'
  | 'device'
  | 'photos'
  | 'archive'
  | 'locked'
  | 'hidden'
  | 'shared';

export interface AssetLocation {
  kind: AssetLocationKind;
  label: string;
}

interface FolderLocation {
  id: string;
  name: string;
  parentId: string | null;
}

interface AssetLocationSource {
  folder: { id: string; name: string } | null;
  albums: { album: { name: string; folderId: string | null } }[];
  deviceAssets: { device: { name: string } }[];
  isDeviceOnly: boolean;
  visibility: string;
}

/** Builds the user-facing paths shared by photo details and Duplicates. */
export function assetLocations(
  asset: AssetLocationSource,
  folders: FolderLocation[],
): AssetLocation[] {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const pathCache = new Map<string, string>();
  const folderPath = (folderId: string) => {
    const cached = pathCache.get(folderId);
    if (cached) return cached;

    const names: string[] = [];
    const visited = new Set<string>();
    let current = foldersById.get(folderId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? foldersById.get(current.parentId) : undefined;
    }

    const path = names.join(' / ');
    pathCache.set(folderId, path);
    return path;
  };

  const locations: AssetLocation[] = [];
  const add = (kind: AssetLocationKind, label: string) => {
    if (
      label &&
      !locations.some((location) => location.kind === kind && location.label === label)
    ) {
      locations.push({ kind, label });
    }
  };

  if (asset.folder) {
    add('folder', `Browse / ${folderPath(asset.folder.id) || asset.folder.name}`);
  }
  for (const membership of asset.albums) {
    const parent = membership.album.folderId
      ? folderPath(membership.album.folderId)
      : '';
    add(
      'album',
      parent
        ? `Browse / ${parent} / ${membership.album.name}`
        : `Browse / ${membership.album.name}`,
    );
  }
  for (const membership of asset.deviceAssets) {
    add('device', `Devices / ${membership.device.name} Library`);
  }

  if (asset.visibility === 'ARCHIVE') add('archive', 'Archive');
  else if (asset.visibility === 'LOCKED') add('locked', 'Locked');
  else if (asset.visibility === 'HIDDEN') add('hidden', 'Hidden');
  else if (!asset.isDeviceOnly && !asset.folder && asset.albums.length === 0) {
    add('photos', 'Photos / Unfiled');
  } else if (locations.length === 0) add('device', 'Device library');

  return locations;
}
