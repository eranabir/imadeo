import { Image, type ImageProps, type ImageSource } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { thumbnail } from '../lib/api';
import { onTokenChanged } from '../lib/auth';

// Keep source identities, not decoded bitmaps or uncancellable preload promises.
// Expo Image owns native request cancellation, downsampling and memory/disk caches.
const displayed = new Map<string, ImageSource>();
let epoch = 0;
const clear = () => { epoch++; displayed.clear(); };
AppState.addEventListener('memoryWarning', clear);
onTokenChanged(token => { if (!token) clear(); });
export function cachedThumbnail(serverUrl: string, assetId: string, token: string | null) {
  return displayed.get(`${serverUrl}\n${token ?? ''}\n${assetId}`);
}

export const AssetThumbnail = memo(function AssetThumbnail({ serverUrl, assetId, token,
  enabled = true, onDisplay, onError, ...props
}: Omit<ImageProps, 'source'> & { serverUrl: string; assetId: string; token: string | null; enabled?: boolean }) {
  const generation = epoch;
  const key = `${serverUrl}\n${token ?? ''}\n${assetId}`;
  const [sharpKey, setSharpKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const small = useMemo(() => thumbnail(serverUrl, assetId, token), [serverUrl, assetId, token]);
  const sharp = useMemo(() => ({ ...small, uri: `${serverUrl}/api/assets/${assetId}/thumbnail?size=preview` }), [small, serverUrl, assetId]);
  const source = sharpKey === key && failedKey !== key ? sharp : small;
  return <Image {...props} source={enabled ? source : null} transition={0} recyclingKey={assetId}
    allowDownscaling cachePolicy="memory-disk" priority={source === small ? 'high' : 'low'}
    onDisplay={() => {
      if (!enabled || generation !== epoch) return;
      displayed.delete(key); displayed.set(key, source);
      while (displayed.size > 40) displayed.delete(displayed.keys().next().value!);
      if (source === small && failedKey !== key) setSharpKey(key);
      onDisplay?.();
    }}
    onError={event => { if (source === sharp) setFailedKey(key); onError?.(event); }} />;
});
