import * as MediaLibrary from 'expo-media-library';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { pendingCount, runBackup, type Progress } from '../lib/backup';
import { colors } from '../theme';

interface Props {
  serverUrl: string;
  onSignOut: () => void;
}

const PAGE = 60;

/**
 * What is on the phone, and what has reached the server.
 *
 * Backup runs in the foreground only: iOS grants no arbitrary background time,
 * so a run continues while this screen is open and resumes from where it
 * stopped next time.
 */
export function BackupScreen({ serverUrl, onSignOut }: Props) {
  const [permission, requestPermission] = MediaLibrary.usePermissions();
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Read inside the upload loop, so Stop takes effect on the next item. */
  const stop = useRef(false);

  const load = useCallback(async () => {
    if (!permission?.granted) return;
    setLoading(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: PAGE,
        mediaType: ['photo', 'video'],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });
      setAssets(page.assets);
      setTotal(page.totalCount);
      setPending(await pendingCount());
    } finally {
      setLoading(false);
    }
  }, [permission?.granted]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 28 }}>
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 }}>
          Let Imadeo see your photos
        </Text>
        <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 23, marginTop: 12, marginBottom: 28 }}>
          Nothing is uploaded until you ask for it. Access is only used to work
          out which photos your server does not have yet.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={({ pressed }) => ({
            backgroundColor: colors.accent,
            borderRadius: 999,
            paddingVertical: 15,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Allow access</Text>
        </Pressable>
        {/* Denying is not fatal — the rest of the app still works, so this is
            phrased as a choice rather than a wall. */}
        <Text
          onPress={onSignOut}
          style={{ color: colors.faint, fontSize: 14, textAlign: 'center', marginTop: 22 }}
        >
          Not now
        </Text>
      </View>
    );
  }

  const size = 3;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 64, paddingBottom: 14 }}>
        <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 }}>
          Backup
        </Text>
        <Text style={{ color: colors.muted, fontSize: 14, marginTop: 4 }}>
          {total === null ? 'Reading your library…' : `${total.toLocaleString()} on this device`}
          {' · '}
          {serverUrl.replace(/^https?:\/\//, '')}
        </Text>

        {/* iOS and Android 14 both allow granting a hand-picked subset. Someone
            in that state sees a count far below what they expect, so it has to
            be named rather than left looking like a bug. */}
        {permission.accessPrivileges === 'limited' && (
          <Text style={{ color: colors.faint, fontSize: 13, lineHeight: 19, marginTop: 10 }}>
            You have shared only selected photos. Imadeo can back up those, and
            nothing else, until you widen access in Settings.
          </Text>
        )}
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
        <Pressable
          onPress={async () => {
            if (progress) {
              // Already running: this press is a stop.
              stop.current = true;
              return;
            }
            stop.current = false;
            setError(null);
            setProgress({ done: 0, total: 0, failed: 0 });
            try {
              await runBackup(serverUrl, setProgress, () => stop.current);
              setPending(await pendingCount());
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Backup failed.');
            } finally {
              setProgress(null);
            }
          }}
          disabled={pending === 0 && !progress}
          style={({ pressed }) => ({
            backgroundColor: progress ? colors.surface : colors.accent,
            borderWidth: progress ? 1 : 0,
            borderColor: colors.border,
            borderRadius: 999,
            paddingVertical: 14,
            alignItems: 'center',
            opacity: pending === 0 && !progress ? 0.45 : pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: progress ? colors.text : '#fff', fontSize: 16, fontWeight: '600' }}>
            {progress
              ? `Stop — ${progress.done} of ${progress.total}`
              : pending === 0
                ? 'Everything is backed up'
                : `Back up ${pending === null ? '' : pending.toLocaleString()} items`}
          </Text>
        </Pressable>

        {progress && progress.total > 0 && (
          <View style={{ height: 3, borderRadius: 999, backgroundColor: colors.border, marginTop: 12, overflow: 'hidden' }}>
            <View
              style={{
                height: '100%',
                width: `${Math.round((progress.done / progress.total) * 100)}%`,
                backgroundColor: colors.accent,
              }}
            />
          </View>
        )}

        {progress && progress.failed > 0 && (
          <Text style={{ color: colors.faint, fontSize: 13, marginTop: 10 }}>
            {progress.failed} could not be sent. They stay queued for next time.
          </Text>
        )}

        {error && (
          <Text style={{ color: colors.danger, fontSize: 14, marginTop: 10 }}>{error}</Text>
        )}
      </View>

      <FlatList
        data={assets}
        keyExtractor={(item) => item.id}
        numColumns={size}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />
        }
        renderItem={({ item }) => (
          <View style={{ flex: 1 / size, aspectRatio: 1, padding: 1 }}>
            <Image source={{ uri: item.uri }} style={{ flex: 1, backgroundColor: colors.surface }} />
            {item.mediaType === 'video' && (
              <View
                style={{
                  position: 'absolute',
                  right: 6,
                  bottom: 5,
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
              No photos found on this device.
            </Text>
          )
        }
      />

      <Pressable onPress={onSignOut} style={{ padding: 18, alignItems: 'center' }}>
        <Text style={{ color: colors.faint, fontSize: 14 }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
