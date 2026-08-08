import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions } from '../lib/actions';
import { useSelectionBar } from '../selection';
import { BAR_MARGIN, BAR_RADIUS, colors, radius, shadow } from '../theme';
import { Glass, liquidGlass } from './Glass';
import { Icon, type IconName } from './Icon';
import { AssignSheet, ConfirmSheet, MoveSheet } from './sheets';
import { Touchable } from './ui';

interface Props {
  serverUrl: string;
  ids: string[];
  /** Whether every selected photo is already a favourite, so the button flips. */
  allFavorite?: boolean;
  onClear: () => void;
  /** Called after anything succeeds, so the screen can refetch. */
  onDone: () => void;
}

/**
 * What you can do with the photos you have picked out.
 *
 * Replaces the tab bar rather than sitting above it: the two would otherwise
 * stack into 140pt of chrome at the bottom of a phone, and while a selection is
 * live the tabs are not what the next tap is for.
 *
 * The five actions are the ones the web client puts on its own selection bar,
 * minus download — a zip landing in a phone's Files app is not what anyone
 * selecting photos here is after.
 */
export function PhotoActions({ serverUrl, ids, allFavorite = false, onClear, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [moving, setMoving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tells the tab bar to stand down while this bar is up, and puts it back on
  // the way out — including when the whole screen is popped mid-selection.
  const { setActive } = useSelectionBar();
  const showing = ids.length > 0;
  useEffect(() => {
    setActive(showing);
    return () => setActive(false);
  }, [showing, setActive]);

  if (!showing) return null;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: Math.max(insets.bottom, BAR_MARGIN),
          paddingHorizontal: BAR_MARGIN,
          zIndex: 30,
          pointerEvents: 'box-none',
        }}
      >
        {error && (
          <View
            style={{
              marginHorizontal: 16,
              marginBottom: 8,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: radius.md,
              backgroundColor: colors.danger,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13.5 }}>{error}</Text>
          </View>
        )}

        <Glass radius={BAR_RADIUS} style={shadow(3)}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 8,
              paddingHorizontal: 4,
              ...(liquidGlass
                ? null
                : {
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.07)',
                    borderRadius: BAR_RADIUS,
                  }),
            }}
          >
            <Action icon="close" label="Clear" onPress={onClear} />

            <Text
              style={{
                color: colors.text,
                fontSize: 13,
                fontWeight: '700',
                paddingHorizontal: 4,
                minWidth: 62,
                textAlign: 'center',
              }}
            >
              {ids.length} picked
            </Text>

            <Action
              // Solid once every picked photo is already a favourite, so the
              // glyph says what they are rather than what the tap will do.
              icon={allFavorite ? 'heart-filled' : 'heart'}
              label={allFavorite ? 'Remove from favourites' : 'Favourite'}
              tint={allFavorite ? colors.danger : undefined}
              disabled={busy}
              onPress={() => run(() => actions.favorite(serverUrl, ids, !allFavorite))}
            />
            <Action icon="move" label="Move" disabled={busy} onPress={() => setMoving(true)} />
            <Action
              icon="person"
              label="Who is this"
              disabled={busy}
              onPress={() => setAssigning(true)}
            />
            <Action
              icon="trash"
              label="Move to trash"
              danger
              disabled={busy}
              onPress={() => setTrashing(true)}
            />
          </View>
        </Glass>
      </View>

      <MoveSheet
        open={moving}
        serverUrl={serverUrl}
        count={ids.length}
        allowAlbums
        onClose={() => setMoving(false)}
        onFolder={(folderId) => run(() => actions.toFolder(serverUrl, folderId, ids))}
        onAlbum={(albumId) => run(() => actions.toAlbum(serverUrl, albumId, ids))}
      />

      <AssignSheet
        open={assigning}
        serverUrl={serverUrl}
        assetIds={ids}
        onClose={() => setAssigning(false)}
        onDone={onDone}
        onError={setError}
      />

      <ConfirmSheet
        open={trashing}
        title={ids.length === 1 ? 'Move this photo to trash?' : `Move ${ids.length} photos to trash?`}
        description="They stay in the trash for 30 days, and can be put back from the web app at any point before that."
        confirmLabel="Move to trash"
        onClose={() => setTrashing(false)}
        onConfirm={() => run(() => actions.trash(serverUrl, ids))}
      />
    </>
  );
}

/**
 * The same bar, for photos that are still only on the phone.
 *
 * Kept beside its server-side twin so the two stay one thing: a selection puts
 * the tab bar away and offers what can be done with what is picked. The verbs
 * differ because the nouns do — a photo in the camera roll cannot be moved to a
 * folder or given a face, and the two that matter are getting it onto the
 * server and getting it off the phone.
 */
export function DeviceActions({
  ids,
  pending,
  busy = false,
  onClear,
  onBackUp,
  onRemove,
}: {
  ids: string[];
  /** How many of the picked are not on the server yet. */
  pending: number;
  busy?: boolean;
  onClear: () => void;
  onBackUp: () => void;
  onRemove: () => void;
}) {
  const insets = useSafeAreaInsets();

  const { setActive } = useSelectionBar();
  const showing = ids.length > 0;
  useEffect(() => {
    setActive(showing);
    return () => setActive(false);
  }, [showing, setActive]);

  if (!showing) return null;

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: Math.max(insets.bottom, BAR_MARGIN),
        paddingHorizontal: BAR_MARGIN,
        zIndex: 30,
        pointerEvents: 'box-none',
      }}
    >
      <Glass radius={BAR_RADIUS} style={shadow(3)}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 8,
            paddingHorizontal: 4,
            ...(liquidGlass
              ? null
              : {
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.07)',
                  borderRadius: BAR_RADIUS,
                }),
          }}
        >
          <Action icon="close" label="Clear" onPress={onClear} />

          <Text
            style={{
              color: colors.text,
              fontSize: 13,
              fontWeight: '700',
              paddingHorizontal: 4,
              minWidth: 62,
              textAlign: 'center',
            }}
          >
            {ids.length} picked
          </Text>

          {/* Nothing left to send is worth saying rather than hiding: the tick
              is why removing them from the phone is safe. */}
          <Action
            icon={pending === 0 ? 'cloud-done' : 'backup'}
            label={pending === 0 ? 'Already backed up' : `Back up ${pending}`}
            tint={pending === 0 ? colors.primary : undefined}
            disabled={busy || pending === 0}
            onPress={onBackUp}
          />
          <Action
            icon="trash"
            label="Remove from this phone"
            danger
            disabled={busy}
            onPress={onRemove}
          />
        </View>
      </Glass>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  danger,
  disabled,
  tint,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  tint?: string;
}) {
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      radius={radius.pill}
      label={label}
      style={{ flex: 1 }}
    >
      <View style={{ alignItems: 'center', paddingVertical: 8 }}>
        <Icon name={icon} size={22} color={tint ?? (danger ? colors.danger : colors.text)} />
      </View>
    </Touchable>
  );
}
