import { Image, type ImageProps, type ImageRef } from 'expo-image';
import { memo, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { thumbnail } from '../lib/api';
import { onTokenChanged } from '../lib/auth';

// FlatList regroups rows after a deletion. Keep a bounded set of decoded
// thumbnails so surviving images render synchronously in their new cells.
// This is deliberately not an original-image cache (at most ~45 MiB).
const decoded = new Map<string, ImageRef>();
const pending = new Map<string, Promise<ImageRef>>();
const LIMIT = 80;
let epoch = 0;
function clear() { epoch++; decoded.clear(); pending.clear(); }
AppState.addEventListener('memoryWarning', clear);
onTokenChanged((token) => { if (!token) clear(); });

/** Reuse the exact decoded grid image for the viewer's first frame. */
export function cachedThumbnail(serverUrl: string, assetId: string, token: string | null) {
  return decoded.get(`${serverUrl}\n${token ?? ''}\n${assetId}`);
}

export const AssetThumbnail = memo(function AssetThumbnail({
  serverUrl, assetId, token, ...props
}: Omit<ImageProps, 'source'> & { serverUrl: string; assetId: string; token: string | null }) {
  const source = useMemo(() => thumbnail(serverUrl, assetId, token), [serverUrl, assetId, token]);
  const key = `${serverUrl}\n${token ?? ''}\n${assetId}`;
  const [loaded, setLoaded] = useState<{ key: string; image: ImageRef } | null>(null);
  const image = decoded.get(key) ?? (loaded?.key === key ? loaded.image : null);
  useEffect(() => {
    if (!token) return;
    const cached = decoded.get(key);
    if (cached) {
      decoded.delete(key);
      decoded.set(key, cached);
      setLoaded({ key, image: cached });
      return;
    }
    let alive = true;
    const started = epoch;
    let task = pending.get(key);
    if (!task) {
      task = Image.loadAsync(source, { maxWidth: 384, maxHeight: 384 });
      pending.set(key, task);
    }
    void task.then((result) => {
      if (started !== epoch) return;
      decoded.set(key, result);
      while (decoded.size > LIMIT) decoded.delete(decoded.keys().next().value!);
      if (alive) setLoaded({ key, image: result });
    }).catch(() => {
      // The regular Image loader below remains responsible for errors/retry.
    }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
    return () => { alive = false; };
  }, [key, source, token]);
  return <Image {...props} source={image ?? source} transition={0} recyclingKey={assetId} />;
});
