import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ensureFreshToken } from '../lib/auth';
import { colors, radius } from '../theme';
import { cachedThumbnail } from './AssetThumbnail';
import { Icon } from './Icon';
import { Touchable } from './ui';
import { ZoomableMedia } from './ZoomableMedia';

const LOAD_TIMEOUT = 20_000;
type Layer = 'thumb' | 'preview' | 'original';
interface Props {
  serverUrl: string;
  token: string | null;
  asset: { id: string };
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  loadOriginal: boolean;
  active: boolean;
  accessibilityLabel?: string;
  onTap?: () => void;
  onZoomChange?: (zoomed: boolean) => void;
}

/** Cached tile → preview → original. A failed upgrade never removes a good image. */
export const ServerPhoto = memo(function ServerPhoto(props: Props) {
  return <PhotoRequest key={`${props.serverUrl}\n${props.asset.id}`} {...props} />;
});

function PhotoRequest({ serverUrl, token, asset, width, height, rotation, loadOriginal,
  active, accessibilityLabel, onTap, onZoomChange }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [retryToken, setRetryToken] = useState<string | null>(null);
  const [displayed, setDisplayed] = useState<Partial<Record<Layer, boolean>>>({});
  const [failed, setFailed] = useState<Partial<Record<Layer, boolean>>>({});
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const alive = useRef(true);
  const recovered = useRef(false);
  const operation = useRef(0);
  const cached = useRef(cachedThumbnail(serverUrl, asset.id, token)).current;
  const visible = !!cached || !!displayed.thumb || !!displayed.preview || !!displayed.original;
  const accessToken = retryToken ?? token;
  const headers = useMemo(() => accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined, [accessToken]);
  const sources = useMemo(() => {
    const url = `${serverUrl}/api/assets/${asset.id}`;
    const retry = attempt ? `&retry=${attempt}` : '';
    return {
      thumb: { uri: `${url}/thumbnail${attempt ? `?retry=${attempt}` : ''}`, headers },
      preview: { uri: `${url}/thumbnail?size=preview${retry}`, headers },
      original: { uri: `${url}/original${attempt ? `?retry=${attempt}` : ''}`, headers },
    };
  }, [serverUrl, asset.id, headers, attempt]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; operation.current++; };
  }, []);
  useEffect(() => {
    if (visible || !loadOriginal) return;
    const timer = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT);
    return () => clearTimeout(timer);
  }, [visible, loadOriginal, attempt]);

  const retry = async () => {
    if (retrying) return;
    const request = ++operation.current;
    setRetrying(true);
    setRetryError(null);
    try {
      const fresh = await ensureFreshToken(serverUrl, 0);
      if (!alive.current || request !== operation.current) return;
      setRetryToken(fresh);
      setFailed({});
      setTimedOut(false);
      setAttempt(value => value + 1);
    } catch {
      if (alive.current && request === operation.current) setRetryError('Could not reconnect. Check your connection and try again.');
    } finally {
      if (alive.current && request === operation.current) setRetrying(false);
    }
  };
  // Images do not go through the JSON client's token-refresh interceptor.
  // Recover once, only on the active page, then offer an explicit Retry.
  useEffect(() => {
    if (!loadOriginal || !failed.preview || !failed.original || visible || recovered.current) return;
    recovered.current = true;
    void retry();
  }, [failed.preview, failed.original, visible, loadOriginal]);

  const show = (layer: Layer) => setDisplayed(value => value[layer] ? value : ({ ...value, [layer]: true }));
  const fail = (layer: Layer) => {
    setFailed(value => ({ ...value, [layer]: true }));
    setDisplayed(value => ({ ...value, [layer]: false }));
  };
  const mediaStyle = {
    width: rotation === 90 || rotation === 270 ? height : width,
    height: rotation === 90 || rotation === 270 ? width : height,
    transform: [{ rotate: `${rotation}deg` }],
  } as const;
  const error = timedOut || !!retryError || (failed.preview && failed.original && failed.thumb);
  return (
    <View style={{ width, height }}>
      <ZoomableMedia width={width} height={height} active={active}
        accessibilityLabel={accessibilityLabel} onTap={onTap} onZoomChange={onZoomChange}>
      {(['thumb', 'preview', 'original'] as const).map(layer => {
        if (layer === 'original' && ((!loadOriginal && !displayed.original) || failed.original)) return null;
        if (layer === 'preview' && (failed.preview || displayed.original)) return null;
        if (layer === 'thumb' && (displayed.preview || displayed.original || (!cached && failed.thumb))) return null;
        return <View key={layer} pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Image
            testID={`viewer-photo-${layer}`}
            source={layer === 'thumb' && cached ? cached : sources[layer]}
            style={mediaStyle}
            contentFit="contain"
            transition={0}
            cachePolicy="memory-disk"
            priority={loadOriginal ? 'high' : 'low'}
            onDisplay={() => show(layer)}
            onError={() => fail(layer)}
          />
        </View>;
      })}
      </ZoomableMedia>
      {/* Recovery is outside the zoom/tap surface: Retry must never also hide
          the controls, and VoiceOver must be able to reach the button. */}
      {!visible && loadOriginal && <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ alignItems: 'center', gap: 12, padding: 18, maxWidth: width - 32,
          backgroundColor: colors.surface, borderRadius: radius.lg }}>
          {error ? <Icon name="photo" size={26} color={colors.muted} /> : <ActivityIndicator color={colors.primary} />}
          <Text style={{ color: colors.text, textAlign: 'center' }}>{error ? retryError ?? 'This photo could not be loaded.' : 'Loading photo…'}</Text>
          {error && <Touchable label="Retry photo" disabled={retrying} onPress={() => void retry()}
            radius={radius.pill} style={{ paddingHorizontal: 18, paddingVertical: 12, backgroundColor: colors.bg }}>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>{retrying ? 'Reconnecting…' : 'Try again'}</Text>
          </Touchable>}
        </View>
      </View>}
    </View>
  );
}
