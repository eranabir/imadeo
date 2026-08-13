import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

/**
 * Retries derivatives that are still being generated after an upload.
 *
 * A video can appear in the library before ffmpeg has written its poster. The
 * first image request therefore fails; changing the query string retries the
 * same stable endpoint without reloading the page or reusing a cached failure.
 */
export function RetryingImage({ src = '', onError, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAttempt(0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [src]);

  const retrySrc =
    attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}thumbnail-retry=${attempt}`;

  return (
    <img
      {...props}
      src={retrySrc}
      onError={(event) => {
        onError?.(event);
        if (attempt >= 15 || timer.current) return;
        timer.current = setTimeout(() => {
          timer.current = null;
          setAttempt((current) => current + 1);
        }, 2000);
      }}
    />
  );
}
