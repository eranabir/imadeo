import clsx from 'clsx';
import type { Album } from '../types';
import { RetryingImage } from './RetryingImage';

/**
 * The one way an album is ever pictured — folder view, Albums page, anywhere.
 *
 * It never falls back to a generic icon:
 *   - four or more photos  -> a 2x2 mosaic
 *   - two or three         -> the cover with a strip beside it
 *   - one                  -> that photo
 *   - none                 -> a tile coloured from the album's own name, with
 *                             its initial, so an empty album still looks like
 *                             something rather than a grey placeholder.
 */
export function AlbumCover({ album, className }: { album: Album; className?: string }) {
  const ids = album.coverAssetIds?.length
    ? album.coverAssetIds
    : album.coverAssetId
      ? [album.coverAssetId]
      : [];

  const src = (id: string) => `/api/assets/${id}/thumbnail`;

  if (ids.length === 0) {
    return <EmptyCover name={album.name} className={className} />;
  }

  // `draggable={false}` throughout: an image drags itself by default, which
  // hijacks the card's own drag and blocks drops over the cover.
  if (ids.length === 1) {
    return (
      <RetryingImage
        src={src(ids[0])}
        assetId={ids[0]}
        thumbnailReady={false}
        alt=""
        loading="lazy"
        draggable={false}
        className={clsx('h-full w-full object-cover', className)}
      />
    );
  }

  if (ids.length < 4) {
    return (
      <span className={clsx('flex h-full w-full gap-px', className)}>
        <RetryingImage
          src={src(ids[0])}
          assetId={ids[0]}
          thumbnailReady={false}
          alt=""
          loading="lazy"
          draggable={false}
          className="h-full w-2/3 object-cover"
        />
        <span className="flex w-1/3 flex-col gap-px">
          {ids.slice(1, 3).map((id) => (
            <RetryingImage
              key={id}
              src={src(id)}
              assetId={id}
              thumbnailReady={false}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full object-cover"
            />
          ))}
        </span>
      </span>
    );
  }

  return (
    <span className={clsx('grid h-full w-full grid-cols-2 grid-rows-2 gap-px', className)}>
      {ids.slice(0, 4).map((id) => (
        <RetryingImage
          key={id}
          src={src(id)}
          assetId={id}
          thumbnailReady={false}
          alt=""
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover"
        />
      ))}
    </span>
  );
}

/** Deterministic hue so an album keeps the same colour between visits. */
const hueFor = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  // Held to the teal/green/blue band so it sits with the rest of the palette.
  return 140 + (hash % 110);
};

function EmptyCover({ name, className }: { name: string; className?: string }) {
  const hue = hueFor(name);

  return (
    <span
      className={clsx('grid h-full w-full place-items-center', className)}
      style={{
        background: `linear-gradient(140deg, oklch(72% 0.11 ${hue}), oklch(46% 0.13 ${(hue + 40) % 360}))`,
      }}
    >
      <span className="text-2xl font-semibold text-white/85">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    </span>
  );
}
