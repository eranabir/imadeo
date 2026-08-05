import { setPhotoDragImage } from './dragPreview';

/**
 * One drag protocol for the whole app.
 *
 * Folders, albums and photos all travel as the same shape, so any drop target
 * can decide what to do with one branch of a switch instead of every surface
 * inventing its own MIME type.
 */
export const DRAG_TYPE = 'application/x-imadeo-item';

export type DragKind = 'folder' | 'album' | 'assets';

export interface DragPayload {
  kind: DragKind;
  ids: string[];
  /** Shown in the drag preview and in messages. */
  label?: string;
}

export function startDrag(
  event: React.DragEvent,
  payload: DragPayload,
  preview?: { image?: HTMLImageElement | null; count?: number },
) {
  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = 'copyMove';

  if (payload.kind === 'assets') {
    setPhotoDragImage(event, preview?.image ?? null, preview?.count ?? payload.ids.length);
  }
}

export function readDrag(event: React.DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    return parsed.ids?.length ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * During dragover the payload cannot be read — the spec only exposes the type
 * list until drop — so targets decide based on the type being present.
 */
export const isDragging = (event: React.DragEvent) =>
  event.dataTransfer.types.includes(DRAG_TYPE);
