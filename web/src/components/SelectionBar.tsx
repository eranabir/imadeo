import { Download, Heart, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  count: number;
  onClear: () => void;
  onFavorite?: () => void;
  onDownload?: () => void;
  onTrash?: () => void;
  children?: ReactNode;
}

/**
 * Floating action bar that appears once photos are selected, so the page chrome
 * stays out of the way when it is not needed.
 */
export function SelectionBar({
  count,
  onClear,
  onFavorite,
  onDownload,
  onTrash,
  children,
}: Props) {
  if (count === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-6">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-neutral-900/92 px-2 py-2 text-white shadow-2xl backdrop-blur">
        <button
          type="button"
          onClick={onClear}
          title="Clear selection"
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"
        >
          <X size={17} />
        </button>

        <span className="px-2 text-sm font-medium tabular-nums">{count} selected</span>

        <span className="mx-1 h-5 w-px bg-white/15" />

        {onFavorite && (
          <button
            type="button"
            onClick={onFavorite}
            title="Favorite"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"
          >
            <Heart size={17} />
          </button>
        )}
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            title="Download"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"
          >
            <Download size={17} />
          </button>
        )}
        {onTrash && (
          <button
            type="button"
            onClick={onTrash}
            title="Move to trash"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"
          >
            <Trash2 size={17} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
