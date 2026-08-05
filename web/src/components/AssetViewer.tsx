import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Info,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, mediaUrl } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Asset } from '../types';

interface Props {
  asset: Asset;
  assets: Asset[];
  onClose: () => void;
  onNavigate: (asset: Asset) => void;
}

export function AssetViewer({ asset, assets, onClose, onNavigate }: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const index = assets.findIndex((a) => a.id === asset.id);
  const previous = index > 0 ? assets[index - 1] : null;
  const next = index >= 0 && index < assets.length - 1 ? assets[index + 1] : null;

  const favorite = useMutation({
    mutationFn: async () =>
      (await api.put(`/assets/${asset.id}`, { isFavorite: !asset.isFavorite })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assets'] }),
  });

  const trash = useMutation({
    mutationFn: async () => (await api.delete('/assets', { data: { ids: [asset.id] } })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      onClose();
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && previous) onNavigate(previous);
      if (event.key === 'ArrowRight' && next) onNavigate(next);
      if (event.key === 'i') setShowInfo((v) => !v);
      if (event.key === 'f') favorite.mutate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previous, next, onClose, onNavigate, favorite]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 fade-in">
      <header className="flex items-center justify-between px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{asset.originalFileName}</p>
          <p className="text-xs text-white/60">
            {formatDateTime(asset.localDateTime, user?.preferences.locale)}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => favorite.mutate()}
            title="Favorite (f)"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10"
          >
            <Heart size={18} fill={asset.isFavorite ? 'currentColor' : 'none'} />
          </button>
          <a
            href={`/api/assets/${asset.id}/download`}
            title="Download"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10"
          >
            <Download size={18} />
          </a>
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            title="Details (i)"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10"
          >
            <Info size={18} />
          </button>
          <button
            type="button"
            onClick={() => trash.mutate()}
            title="Move to trash"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10"
          >
            <Trash2 size={18} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {previous && (
          <button
            type="button"
            onClick={() => onNavigate(previous)}
            className="absolute left-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <ChevronLeft size={22} />
          </button>
        )}

        <div className="grid min-w-0 flex-1 place-items-center p-4">
          {asset.type === 'VIDEO' ? (
            <video
              key={asset.id}
              src={mediaUrl(asset.id, 'video')}
              poster={mediaUrl(asset.id, 'preview')}
              controls
              autoPlay={user?.preferences.autoplayVideos}
              loop={user?.preferences.loopVideos}
              playsInline
              className="max-h-full max-w-full"
            />
          ) : (
            <img
              key={asset.id}
              src={mediaUrl(asset.id, 'preview')}
              alt={asset.originalFileName}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        {next && (
          <button
            type="button"
            onClick={() => onNavigate(next)}
            className="absolute right-2 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <ChevronRight size={22} />
          </button>
        )}

        {showInfo && (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 bg-black/60 p-5 text-sm text-white">
            <h2 className="mb-3 font-medium">Details</h2>
            <dl className="space-y-2 text-xs">
              <Row label="File" value={asset.originalFileName} />
              <Row label="Size" value={formatBytes(asset.fileSizeInByte)} />
              <Row
                label="Taken"
                value={formatDateTime(asset.localDateTime, user?.preferences.locale)}
              />
              {asset.exif?.exifImageWidth && (
                <Row
                  label="Dimensions"
                  value={`${asset.exif.exifImageWidth} × ${asset.exif.exifImageHeight}`}
                />
              )}
              {asset.exif?.make && (
                <Row label="Camera" value={`${asset.exif.make} ${asset.exif.model ?? ''}`.trim()} />
              )}
              {asset.exif?.lensModel && <Row label="Lens" value={asset.exif.lensModel} />}
              {asset.exif?.fNumber && (
                <Row
                  label="Exposure"
                  value={[
                    `f/${asset.exif.fNumber}`,
                    asset.exif.exposureTime && `${asset.exif.exposureTime}s`,
                    asset.exif.iso && `ISO ${asset.exif.iso}`,
                    asset.exif.focalLength && `${asset.exif.focalLength}mm`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              )}
              {asset.exif?.latitude != null && (
                <Row
                  label="Location"
                  value={`${asset.exif.latitude.toFixed(5)}, ${asset.exif.longitude?.toFixed(5)}`}
                />
              )}
              {asset.exif?.timeZone && <Row label="Time zone" value={asset.exif.timeZone} />}
            </dl>
          </aside>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-white/50">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
