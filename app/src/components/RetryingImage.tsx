import clsx from 'clsx';
import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { useThumbnailReadiness } from './ThumbnailReadiness';

// A valid image source keeps browsers from drawing their native broken-image
// icon and visible alt text while the real derivative is still processing.
const TRANSPARENT_PIXEL =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%2F%3E';

/**
 * Shows a generated derivative or a calm placeholder while the shared
 * readiness poll waits for the server to finish it.
 */
export function RetryingImage({
  src = '',
  assetId,
  thumbnailReady,
  className,
  alt,
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
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoaded(Boolean(assetId && readiness.wasLoaded(assetId)));
    setFailed(false);
    setAttempt(0);
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [assetId, derivativeReady, readiness.wasLoaded, src]);

  useEffect(() => {
    if (!assetId || thumbnailReady !== false || !readiness.active) return;
    return readiness.watch(assetId);
  }, [assetId, readiness.active, readiness.watch, thumbnailReady]);

  const derivativeSrc =
    attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}thumbnail-retry=${attempt}`;
  const showingDerivative = derivativeReady && !failed;

  return (
    <img
      {...props}
      src={showingDerivative ? derivativeSrc : TRANSPARENT_PIXEL}
      alt={showingDerivative ? alt : ''}
      aria-label={!showingDerivative && alt ? alt : undefined}
      aria-busy={!loaded}
      data-thumbnail-state={loaded ? 'ready' : 'processing'}
      className={clsx(className, !loaded && 'thumbnail-placeholder')}
      onLoad={(event) => {
        // The transparent pixel is only a canvas for the animated placeholder.
        // It must not mark a server derivative as successfully loaded.
        if (!showingDerivative) return;
        if (assetId) readiness.markLoaded(assetId);
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setLoaded(false);
        setFailed(true);
        onError?.(event);
        if (attempt >= 15 || retryTimer.current) return;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          setAttempt((current) => current + 1);
          setFailed(false);
        }, 2_000);
      }}
    />
  );
}
