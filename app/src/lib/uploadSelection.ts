import type { UploadCandidate } from './uploadHistory';

export interface DroppedEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (callback: (file: File) => void, onError?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (
      callback: (entries: DroppedEntry[]) => void,
      onError?: (error: DOMException) => void,
    ) => void;
  };
}

// Keep this list aligned with AssetService so drag-and-drop does not discard a
// format that the server can store (RAW files commonly have no useful MIME type).
export const MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.tif', '.tiff',
  '.bmp', '.svg', '.jxl', '.dng', '.cr2', '.cr3', '.nef', '.arw', '.raf', '.orf', '.rw2',
  '.pef', '.srw', '.raw', '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp', '.mpg',
  '.mpeg', '.wmv', '.flv', '.mts', '.m2ts', '.insv',
]);

export const MEDIA_ACCEPT = ['image/*', 'video/*', ...MEDIA_EXTENSIONS].join(',');

export const isMediaFile = (file: File) =>
  file.type.startsWith('image/') ||
  file.type.startsWith('video/') ||
  MEDIA_EXTENSIONS.has(file.name.slice(file.name.lastIndexOf('.')).toLowerCase());

/** Top-level directories that must appear as soon as a folder upload starts. */
export const uploadRootSegments = (candidates: UploadCandidate[]) => [
  ...new Set(
    candidates.flatMap(({ relativePath }) => {
      const segments = relativePath?.split(/[/\\]/).filter(Boolean) ?? [];
      return segments.length > 1 ? [segments[0]] : [];
    }),
  ),
];

export async function filesFromEntry(
  entry: DroppedEntry,
  parent = '',
): Promise<UploadCandidate[]> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;

  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    return [{ file, relativePath: path }];
  }

  if (!entry.isDirectory || !entry.createReader) return [];
  const reader = entry.createReader();
  const children: DroppedEntry[] = [];

  // Chromium returns directory entries in batches (usually 100). Reading once
  // silently loses the rest, so continue until the explicit empty batch.
  while (true) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    children.push(...batch);
  }

  return (await Promise.all(children.map((child) => filesFromEntry(child, path)))).flat();
}

export async function filesFromDrop(dataTransfer: DataTransfer): Promise<UploadCandidate[]> {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item): DroppedEntry | null =>
      (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => FileSystemEntry | null;
        }
      ).webkitGetAsEntry?.() as DroppedEntry | null,
    )
    .filter((entry): entry is DroppedEntry => Boolean(entry));

  if (entries.length > 0) {
    return (await Promise.all(entries.map((entry) => filesFromEntry(entry)))).flat();
  }
  return [...dataTransfer.files].map((file) => ({ file }));
}
