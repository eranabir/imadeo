import { useRef, useState } from 'react';
import { isDragging, readDrag, type DragPayload } from './dnd';

interface Options {
  /** 'move' for folders, 'copy' for albums — drives the cursor badge. */
  effect?: 'move' | 'copy';
  onDrop: (payload: DragPayload) => void;
  /** Called on the first dragenter, e.g. to auto-expand a folder. */
  onEnter?: () => void;
}

export function handleInternalDrop(
  event: React.DragEvent,
  onDrop: (payload: DragPayload) => void,
) {
  if (!isDragging(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  const payload = readDrag(event);
  if (payload) onDrop(payload);
  return true;
}

/**
 * Makes a whole element a drop target, children included.
 *
 * The subtlety this exists for: `dragleave` fires every time the pointer
 * crosses into a child node, so a card containing an image would drop its
 * highlight — and appear inert — everywhere except the bare strip with no
 * children in it. Counting enter/leave pairs means the target only deactivates
 * when the pointer genuinely leaves its subtree.
 */
export function useDropTarget({ effect = 'move', onDrop, onEnter }: Options) {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);

  return {
    isOver,
    dropProps: {
      onDragEnter: (event: React.DragEvent) => {
        if (!isDragging(event)) return;
        event.preventDefault();
        depth.current += 1;
        if (depth.current === 1) {
          setIsOver(true);
          onEnter?.();
        }
      },
      onDragOver: (event: React.DragEvent) => {
        if (!isDragging(event)) return;
        // Required on every dragover, or the browser refuses the drop and
        // shows the red "no drop" cursor.
        event.preventDefault();
        event.dataTransfer.dropEffect = effect;
      },
      onDragLeave: (event: React.DragEvent) => {
        if (!isDragging(event)) return;
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setIsOver(false);
        }
      },
      onDrop: (event: React.DragEvent) => {
        // Finder/Explorer drops belong to the app-wide upload handler. Do not
        // swallow them when the pointer happens to be over a folder or album.
        if (!handleInternalDrop(event, onDrop)) return;
        depth.current = 0;
        setIsOver(false);
      },
    },
  };
}
