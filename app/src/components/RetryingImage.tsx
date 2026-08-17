import clsx from 'clsx';
import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { useThumbnailReadiness } from './ThumbnailReadiness';

/**
 * Shows a generated derivative or a calm placeholder while the shared
 * readiness poll waits for the server to finish it.
 */
export function RetryingImage({
  src = '',
  assetId,
  thumbnailReady,
  className,
  onLoad,
  onError,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  assetId?: string;
  thumbnailReady?: boolean;
}) {
  const readiness = useThumbnailReadiness();
  const derivativeReady =
    thumbnailReady !== false ||
    !assetId ||
    !readiness.active ||
    readiness.isReady(assetId);
  const [loaded, setLoaded] = useState(() => Boolean(assetId && readiness.wasLoaded(assetId)));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(Boolean(assetId && readiness.wasLoaded(assetId)));
    setFailed(false);
  }, [assetId, derivativeReady, readiness.wasLoaded, src]);

  useEffect(() => {
    if (!assetId || thumbnailReady !== false || !readiness.active) return;
    return readiness.watch(assetId);
  }, [assetId, readiness.active, readiness.watch, thumbnailReady]);

  const effectiveSrc = derivativeReady && !failed ? src : undefined;

  return (
    <img
      {...props}
      src={effectiveSrc || undefined}
      aria-busy={!loaded}
      className={clsx(className, !loaded && 'thumbnail-placeholder')}
      onLoad={(event) => {
        if (assetId) readiness.markLoaded(assetId);
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setLoaded(false);
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
