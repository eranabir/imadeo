import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useHeaderClearance } from '../components/Header';
import { useHeaderSlot } from '../header';
import { Icon } from '../components/Icon';
import { Action, Choice, Group, Row, StorageRow, SwitchRow } from '../components/settings';
import { useResource } from '../lib/api';
import {
  setAppearance,
  setAutoplayVideos,
  setCellularAllowed,
  useAppearance,
  useAutoplayVideos,
  useCellularAllowed,
} from '../lib/preferences';
import { isAvailable, isEnabled, setEnabled } from '../lib/autobackup';
import { colors, radius, TAB_BAR_CLEARANCE } from '../theme';

/**
 * The background-backup setting, and whether the phone will honour it.
 *
 * Availability is asked for separately because it is not the same question as
 * whether it is switched on: someone can turn it on and have the system refuse
 * anyway, and a row that only said "On" would be lying to them.
 */
function useAutoBackup() {
  const [on, setOn] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [enabled, allowed] = await Promise.all([isEnabled(), isAvailable()]);
    setOn(enabled);
    setAvailable(allowed);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (next: boolean) => {
      setBusy(true);
      // Moved before the await so the switch answers the finger rather than the
      // system; `refresh` puts it back if the registration is refused.
      setOn(next);
      try {
        await setEnabled(next);
      } finally {
        await refresh();
        setBusy(false);
      }
    },
    [refresh],
  );

  return { on, available, busy, toggle };
}

interface Props {
  serverUrl: string;
  onChangeServer: () => void;
}

interface Statistics {
  images: number;
  videos: number;
  total: number;
  /**
   * A string, not a number. The column is a bigint, and the server serialises
   * those through `BigInt.prototype.toJSON` — reading it as a number here
   * silently gives NaN on any library past a few gigabytes.
   */
  usageInBytes: string;
  /**
   * Real numbers for the volume the library sits on.
   *
   * From `/users/me/statistics` rather than `/assets/statistics`, which counts
   * assets but knows nothing about the disk — the same endpoint the web
   * client's storage card reads, so the two agree.
   */
  disk?: {
    totalBytes: number | null;
    availableBytes: number | null;
    usedBytes: number | null;
  };
}

interface Me {
  /** A cap set for this account, if any. Null means the disk is the limit. */
  quotaSizeInBytes?: string | number | null;
}

export function SettingsScreen({ serverUrl, onChangeServer }: Props) {
  const { data } = useResource<Statistics>(serverUrl, '/users/me/statistics');
  const me = useResource<Me>(serverUrl, '/users/me');
  const auto = useAutoBackup();
  const autoplay = useAutoplayVideos();
  const cellular = useCellularAllowed();
  const appearance = useAppearance();

  /**
   * Room this library has, not the size of the disk.
   *
   * A quota if the account has one, otherwise what is used plus what is still
   * free on the volume. Measuring against the disk's total would report a
   * nearly full bar for an empty library sharing a disk with everything else,
   * which is the mistake the web client's card documents.
   */
  const quota = me.data?.quotaSizeInBytes ? Number(me.data.quotaSizeInBytes) : null;
  const free = data?.disk?.availableBytes ?? null;
  const capacity =
    quota ?? (data && free !== null ? Number(data.usageInBytes) + free : null);
  const clearance = useHeaderClearance();

  // Like every other tab: the bar is the shell's, so it stays put while this
  // page slides in and out from under it.
  useHeaderSlot('settings', { title: 'Settings', icon: 'settings' }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>

      <ScrollView
        contentContainerStyle={{
          paddingTop: clearance + 16,
          paddingBottom: TAB_BAR_CLEARANCE,
          paddingHorizontal: 16,
        }}
      >
        <Group>
          <Row
            icon="backup"
            label="Server"
            value={serverUrl.replace(/^https?:\/\//, '')}
            // A green dot only when the server has actually answered — the
            // statistics request is the proof, so nothing else has to be asked.
            dot={data ? colors.online : me.error ? colors.danger : undefined}
          />
          <Row icon="library" label="Photos" value={data ? data.images.toLocaleString() : '—'} />
          <Row icon="play" label="Videos" value={data ? data.videos.toLocaleString() : '—'} />
          <StorageRow
            used={data ? Number(data.usageInBytes) : null}
            capacity={capacity}
          />
        </Group>

        <Group title="Backup">
          <SwitchRow
            icon="backup"
            label="Back up in the background"
            hint={
              auto.available === false
                ? 'Your phone has background activity switched off for Imadeo.'
                : 'Keep sending while Imadeo is closed'
            }
            on={auto.on}
            disabled={auto.available === false || auto.busy}
            onChange={auto.toggle}
          />

          {/* Photos and videos apart, because their sizes are not comparable: a
              day of pictures is tens of megabytes and one video can be more
              than all of them. Both start off, so mobile data is never spent by
              a run nobody asked for.

              Every hint here says what its switch does and does not change with
              it. A hint that flips between two readings makes you toggle the
              thing to find out which way round it is, and one that grows a line
              when you turn it on moves everything under it. */}
          <SwitchRow
            icon="library"
            label="Photos"
            hint="Use mobile data to back up photos"
            on={cellular.photos}
            onChange={(next) => void setCellularAllowed({ ...cellular, photos: next })}
          />
          <SwitchRow
            icon="play"
            label="Videos"
            hint="Use mobile data to back up videos"
            on={cellular.videos}
            onChange={(next) => void setCellularAllowed({ ...cellular, videos: next })}
          />
        </Group>

        <Group>
          <SwitchRow
            icon="play"
            label="Play videos automatically"
            hint={
              autoplay
                ? 'A video starts as soon as you open it.'
                : 'Videos wait for you to press play.'
            }
            on={autoplay}
            onChange={(next) => void setAutoplayVideos(next)}
          />

          {/* Three plain words. What the app is made of — glass, blur, whatever
              the platform gives it — is not the user's business; whether it is
              light or dark is. */}
          <View style={{ paddingVertical: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name="sparkle" size={19} color={colors.primary} />
              <Text style={{ flex: 1, color: colors.text, fontSize: 15.5, fontWeight: '600' }}>
                Appearance
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['system', 'dark', 'light'] as const).map((mode) => (
                <Choice
                  key={mode}
                  label={mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light'}
                  active={appearance === mode}
                  onPress={() => void setAppearance(mode)}
                />
              ))}
            </View>
          </View>
        </Group>

        <Action label="Connect to a different server" onPress={onChangeServer} />
      </ScrollView>
    </View>
  );
}

/**
 * How much room is left, as a figure and a bar.
 *
 * A number on its own says nothing — five gigabytes is either nothing or
 * everything depending on what it is out of.
 */
