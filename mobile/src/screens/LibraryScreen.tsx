import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { storedToken } from '../lib/auth';
import { colors } from '../theme';

interface Asset {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  duration?: number | null;
}

interface Props {
  serverUrl: string;
}

const COLUMNS = 3;

/** What is already on the server, as opposed to what is still on the phone. */
export function LibraryScreen({ serverUrl }: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await storedToken();
      setToken(auth);

      const response = await fetch(`${serverUrl}/api/assets?size=120&sortBy=date&order=desc`, {
        headers: { Authorization: `Bearer ${auth}` },
      });
      if (!response.ok) throw new Error(`Server answered ${response.status}`);

      const body = await response.json();
      setAssets(body.items ?? []);
      setTotal(body.pagination?.total ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your library.');
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 64, paddingBottom: 12 }}>
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 }}>
          Library
        </Text>
        <Text style={{ color: colors.muted, fontSize: 14, marginTop: 4 }}>
          {total === null ? 'Loading…' : `${total.toLocaleString()} on your server`}
          {' · '}
          {serverUrl.replace(/^https?:\/\//, '')}
        </Text>
        {error && (
          <Text style={{ color: colors.danger, fontSize: 14, marginTop: 10 }}>{error}</Text>
        )}
      </View>

      <FlatList
        data={assets}
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
        }
        renderItem={({ item }) => (
          <View style={{ flex: 1 / COLUMNS, aspectRatio: 1, padding: 1 }}>
            {/* Thumbnails are behind the same auth as everything else, so the
                token travels as a header rather than in the URL — a query
                string would end up in server logs. */}
            <Image
              source={{
                uri: `${serverUrl}/api/assets/${item.id}/thumbnail`,
                headers: token ? { Authorization: `Bearer ${token}` } : undefined,
              }}
              style={{ width: '100%', height: '100%', backgroundColor: colors.surface }}
              contentFit="cover"
              recyclingKey={item.id}
              transition={120}
            />
            {item.type === 'VIDEO' && (
              <View
                style={{
                  position: 'absolute',
                  right: 5,
                  bottom: 4,
                  width: 0,
                  height: 0,
                  borderTopWidth: 4,
                  borderBottomWidth: 4,
                  borderLeftWidth: 7,
                  borderTopColor: 'transparent',
                  borderBottomColor: 'transparent',
                  borderLeftColor: '#fff',
                }}
              />
            )}
          </View>
        )}
        ListEmptyComponent={
          loading ? null : (
            <Text style={{ color: colors.faint, textAlign: 'center', marginTop: 40 }}>
              Nothing here yet. Back up some photos and they will appear.
            </Text>
          )
        }
      />
    </View>
  );
}
