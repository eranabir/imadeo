import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Info,
  Maximize2,
  Pause,
  Play,
  RotateCw,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, mediaUrl } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Asset } from '../types';
import { ConfirmDialog, IconButton } from '../ui';

interface Props {
  asset: Asset;
  assets: Asset[];
  onClose: () => void;
  onNavigate: (asset: Asset) => void;
}

export function AssetViewer({ asset, assets, onClose, onNavigate }: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [rotations, setRotations] = useState<Record<string, number>>({});
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isShared = asset.ownerId !== user?.id;
  const rotation = rotations[asset.id] ?? asset.rotation ?? 0;

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
      // The same asset can be open from Photos, an album, a folder, search, or
      // People & Pets. Refresh every cached view so a trashed item cannot stay
      // visible and look as though deletion failed.
      void queryClient.invalidateQueries();
      onClose();
    },
  });

  const rotate = useMutation({
    mutationFn: async (next: number) =>
      (await api.put(`/assets/${asset.id}`, { rotation: next })).data,
    onSuccess: (_, next) => {
      setRotations((current) => ({ ...current, [asset.id]: next }));
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && previous) onNavigate(previous);
      if (event.key === 'ArrowRight' && next) onNavigate(next);
      if (event.key === 'i') setShowInfo((v) => !v);
      if (event.key === 'f') favorite.mutate();
      if (event.key === 'r' && !isShared && !rotate.isPending) {
        rotate.mutate((rotation + 90) % 360);
      }
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
            onClick={() => rotate.mutate((rotation + 90) % 360)}
            title="Rotate clockwise (r)"
            disabled={isShared || rotate.isPending}
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/10 disabled:opacity-40"
          >
            <RotateCw size={18} />
          </button>
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
            onClick={() => setConfirmTrash(true)}
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

        <div className="min-h-0 min-w-0 flex-1 p-4">
          <RotatedMedia asset={asset} rotation={rotation} />
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

      <ConfirmDialog
        open={confirmTrash}
        title={isShared ? 'Remove this shared photo?' : 'Move this photo to trash?'}
        description={
          isShared
            ? "It will disappear from your library. The owner's copy will not be deleted."
            : 'You can restore it from Trash for 30 days.'
        }
        confirmLabel={isShared ? 'Remove from library' : 'Move to trash'}
        destructive
        onConfirm={() => trash.mutate()}
        onClose={() => setConfirmTrash(false)}
      />
    </div>
  );
}

function RotatedMedia({ asset, rotation }: { asset: Asset; rotation: number }) {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { user } = useAuth();

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  const quarterTurn = rotation === 90 || rotation === 270;
  const style: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: size.width ? (quarterTurn ? size.height : size.width) : '100%',
    height: size.height ? (quarterTurn ? size.width : size.height) : '100%',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    objectFit: 'contain',
  };

  return (
    <div ref={area} className="relative h-full w-full overflow-hidden">
      {asset.type === 'VIDEO' ? (
        <RotatedVideo
          key={asset.id}
          asset={asset}
          style={style}
          autoPlay={user?.preferences.autoplayVideos}
          loop={user?.preferences.loopVideos}
        />
      ) : (
        <img
          key={asset.id}
          src={mediaUrl(asset.id, 'preview')}
          alt={asset.originalFileName}
          style={style}
        />
      )}
    </div>
  );
}

function RotatedVideo({
  asset,
  style,
  autoPlay,
  loop,
}: {
  asset: Asset;
  style: CSSProperties;
  autoPlay?: boolean;
  loop?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlayback = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen();
  };

  return (
    <div ref={frame} className="absolute inset-0">
      <video
        ref={video}
        src={mediaUrl(asset.id, 'video')}
        poster={mediaUrl(asset.id, 'preview')}
        autoPlay={autoPlay}
        loop={loop}
        playsInline
        style={style}
        onClick={togglePlayback}
        onDoubleClick={toggleFullscreen}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
      />

      <div className="absolute inset-x-4 bottom-4 z-10 flex items-center gap-3 rounded-panel bg-black/70 px-3 py-2 text-white backdrop-blur-sm">
        <IconButton
          onClick={togglePlayback}
          label={playing ? 'Pause' : 'Play'}
          size="sm"
          round={false}
          className="text-white hover:bg-white/10 hover:text-white"
        >
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </IconButton>

        <span className="w-11 text-right text-xs tabular-nums text-white/70">
          {videoTime(currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (video.current) video.current.currentTime = next;
            setCurrentTime(next);
          }}
          aria-label="Video position"
          className="h-1 min-w-0 flex-1 cursor-pointer accent-accent"
        />
        <span className="w-11 text-xs tabular-nums text-white/70">{videoTime(duration)}</span>

        <IconButton
          onClick={() => {
            const next = !muted;
            if (video.current) video.current.muted = next;
            setMuted(next);
          }}
          label={muted ? 'Unmute' : 'Mute'}
          size="sm"
          round={false}
          className="text-white hover:bg-white/10 hover:text-white"
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </IconButton>
        <IconButton
          onClick={toggleFullscreen}
          label="Full screen"
          size="sm"
          round={false}
          className="text-white hover:bg-white/10 hover:text-white"
        >
          <Maximize2 size={18} />
        </IconButton>
      </div>
    </div>
  );
}

function videoTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-white/50">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
