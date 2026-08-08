import { Image } from 'expo-image';
/*
 * The legacy entry, deliberately.
 *
 * SDK 57 rewrote this module: an `Asset` is now an object of getters
 * (`getCreationTime`, `getMediaType`) rather than plain fields, and `SortBy`
 * has gone from the main export. That is a migration of its own — the backup
 * engine and the device grid both read these fields all over — and it does not
 * belong in the middle of a navigation migration. `expo-file-system` is
 * imported the same way here for the same reason.
 */
import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { Empty } from '../components/AssetGrid';
import { Header, useHeaderClearance } from '../components/Header';
import { Icon, type IconName } from '../components/Icon';
import type { Attempt, Progress } from '../lib/backup';
import { colors, radius, TAB_BAR_CLEARANCE } from '../theme';

interface Props {
  progress: Progress | null;
  /** What the last finished run left behind, when nothing is running now. */
  onBack: () => void;
}

type State = 'sent' | 'sending' | 'waiting' | 'failed';

const LOOK: Record<State, { icon: IconName; tint: string; label: string }> = {
  sent: { icon: 'done', tint: '#34d399', label: 'On your server' },
  sending: { icon: 'backup', tint: colors.primary, label: 'Sending…' },
  waiting: { icon: 'photo', tint: colors.faint, label: 'Waiting' },
  failed: { icon: 'close', tint: colors.danger, label: 'Failed' },
};

/**
 * Every photo in the run, and what happened to each.
 *
 * The bar in the header says how far along a backup is; it cannot say which
 * photo is going up, or which three of two hundred did not make it and why.
 * That is what someone actually wants when a run finishes with failures, and
 * a count in a corner has never once answered it.
 */
export function BackupProgressScreen({ progress, onBack }: Props) {
  const clearance = useHeaderClearance(0);
  /** Local thumbnails, resolved lazily — the queue holds ids, not images. */
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const queue = progress?.queue ?? [];
  const sent = new Set(progress?.sent ?? []);
  const failed = new Map((progress?.failures ?? []).map((f) => [f.id, f]));
  const currentId = progress && progress.at >= 0 ? queue[progress.at]?.id : null;

  /**
   * Only the ids on screen are looked up, and only once each.
   *
   * `getAssetInfoAsync` hits the Photos database per call, and a two-hundred
   * item queue asking on every re-render would spend the whole backup doing
   * that instead of uploading.
   */
  useEffect(() => {
    let alive = true;
    const missing = queue.slice(0, 60).filter((item) => !(item.id in thumbs));
    if (missing.length === 0) return;

    (async () => {
      const found: Record<string, string> = {};
      for (const item of missing) {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(item.id);
          if (info?.uri) found[item.id] = info.uri;
        } catch {
          // A photo the library will not open still belongs in the list; it
          // simply shows without a picture.
        }
      }
      if (alive && Object.keys(found).length > 0) {
        setThumbs((current) => ({ ...current, ...found }));
      }
    })();

    return () => {
      alive = false;
    };
  }, [queue, thumbs]);

  const stateOf = (item: Attempt): State =>
    failed.has(item.id) ? 'failed' : sent.has(item.id) ? 'sent' : item.id === currentId ? 'sending' : 'waiting';

  const running = progress !== null && progress.at >= 0;
  const subtitle = progress
    ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} sent` +
      (progress.failed > 0 ? ` · ${progress.failed} failed` : '')
    : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Backing up" subtitle={subtitle} icon="backup" onBack={onBack} />

      <FlatList
        data={queue}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingTop: clearance + 8,
          paddingBottom: TAB_BAR_CLEARANCE,
          paddingHorizontal: 16,
          gap: 8,
        }}
        // The queue can be thousands long and every row is the same height.
        initialNumToRender={14}
        windowSize={7}
        ListEmptyComponent={
          <Empty
            icon="done"
            title="Nothing to back up"
            body="Everything on this phone is already on your server."
          />
        }
        renderItem={({ item }) => {
          const state = stateOf(item);
          const look = LOOK[state];
          const uri = thumbs[item.id];

          return (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 10,
                borderRadius: radius.md,
                backgroundColor: colors.surface,
              }}
            >
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: radius.sm,
                  overflow: 'hidden',
                  backgroundColor: colors.raised,
                }}
              >
                {uri && (
                  <Image
                    source={uri}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    recyclingKey={item.id}
                    transition={120}
                  />
                )}
              </View>

              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14.5, fontWeight: '600' }}>
                  {item.filename}
                </Text>
                <Text
                  numberOfLines={2}
                  style={{ color: state === 'failed' ? colors.danger : colors.faint, fontSize: 12.5, marginTop: 2 }}
                >
                  {/* The reason, when there is one — that is the whole point of
                      keeping it rather than counting it. */}
                  {failed.get(item.id)?.reason ?? look.label}
                </Text>
              </View>

              {state === 'sending' ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Icon name={look.icon} size={18} color={look.tint} strong={state === 'failed'} />
              )}
            </View>
          );
        }}
      />

      {!running && progress !== null && (
        <View
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: TAB_BAR_CLEARANCE - 40,
            padding: 14,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ color: colors.muted, fontSize: 13.5, lineHeight: 20 }}>
            {progress.failed > 0
              ? `This run finished with ${progress.failed} still to send. They stay queued and go again next time.`
              : 'This run has finished.'}
          </Text>
        </View>
      )}
    </View>
  );
}
