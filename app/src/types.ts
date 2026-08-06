export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  isLocked: boolean;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  assetCount: number;
  albumCount: number;
  /** Only present in folder-contents listings, not in the full tree. */
  childCount?: number;
  children: FolderNode[];
  /** Albums filed in this folder, shown nested in the sidebar tree. */
  albums?: {
    id: string;
    name: string;
    assetCount: number;
    coverAssetId: string | null;
    coverAssetIds: string[];
  }[];
}

export interface AssetExif {
  make: string | null;
  model: string | null;
  lensModel: string | null;
  exifImageWidth: number | null;
  exifImageHeight: number | null;
  dateTimeOriginal: string | null;
  timeZone: string | null;
  fNumber: number | null;
  focalLength: number | null;
  iso: number | null;
  exposureTime: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  description: string;
  rating: number | null;
  fps: number | null;
}

export interface Asset {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OTHER';
  originalFileName: string;
  fileSizeInByte: string;
  localDateTime: string;
  fileCreatedAt: string;
  /** When it was uploaded, as opposed to when it was taken. */
  createdAt: string;
  isFavorite: boolean;
  visibility: 'TIMELINE' | 'ARCHIVE' | 'HIDDEN' | 'LOCKED';
  duration: string | null;
  thumbnailPath: string | null;
  folderId: string | null;
  deletedAt: string | null;
  purgeAt?: string;
  exif?: AssetExif | null;
}

export interface Album {
  id: string;
  name: string;
  description: string;
  thumbnailAssetId: string | null;
  /** Cover to render: the chosen thumbnail, or the newest photo inside. */
  coverAssetId: string | null;
  /** Up to four photos from the album, for a mosaic cover. */
  coverAssetIds: string[];
  folderId: string | null;
  isLocked: boolean;
  order: 'asc' | 'desc';
  assetCount: number;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; name: string; email: string };
  /** The folder this album is filed under, when it is in one. */
  folder?: { id: string; name: string; path: string } | null;
  albumUsers?: { userId: string; role: 'VIEWER' | 'EDITOR'; user: { id: string; name: string } }[];
  shared?: boolean;
}

export interface FolderContents {
  folder: FolderNode | null;
  breadcrumbs: { id: string; name: string; isLocked: boolean }[];
  folders: FolderNode[];
  albums: Album[];
  assets: Asset[];
  pagination: { page: number; size: number; total: number; pages: number };
}

export interface Paginated<T> {
  items: T[];
  pagination: { page: number; size: number; total: number; pages: number };
}

export interface AssetStatistics {
  images: number;
  videos: number;
  total: number;
  favorites: number;
  trashed: number;
  archived: number;
  locked: number;
  usageInBytes: string;
}

export interface UserStatistics extends AssetStatistics {
  /** Real numbers for the volume the library is stored on. */
  disk: {
    totalBytes: number | null;
    availableBytes: number | null;
    usedBytes: number | null;
  };
}
