import { useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions } from '../lib/actions';
import { useSelectionBar, useSelectionDock } from '../selection';
import { colors, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { AssignSheet, ConfirmSheet, MoveSheet, ShareSheet } from './sheets';
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
 * The actions are the ones the web client puts on its own selection bar, minus
 * download — a zip landing in a phone's Files app is not what anyone selecting
 * photos here is after. `Dock` below is the panel they arrive on.
 */
export function PhotoActions({ serverUrl, ids, allFavorite = false, onClear, onDone }: Props) {
  const [moving, setMoving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [sharing, setSharing] = useState(false);
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

  /*
   * Keyed on the ids themselves rather than the array holding them.
   *
   * A new array every render would republish every render, and publishing is a
   * state change on the provider — which renders this again. The contents are
   * what the panel actually depends on.
   */
  useSelectionDock(
    showing ? (
      <Dock count={ids.length} error={error} onClear={onClear}>
        <ToolbarAction
          // Solid once every picked photo is already a favourite, so the glyph
          // says what they are rather than what the tap will do.
          icon={allFavorite ? 'heart-filled' : 'heart'}
          label={allFavorite ? 'Unfavourite' : 'Favourite'}
          disabled={busy}
          onPress={() => run(() => actions.favorite(serverUrl, ids, !allFavorite))}
        />
        <ToolbarAction icon="move" label="Move" disabled={busy} onPress={() => setMoving(true)} />
        <ToolbarAction
          icon="people-and-pets"
          label="Who is this"
          disabled={busy}
          onPress={() => setAssigning(true)}
        />
        <ToolbarAction icon="shared" label="Share" disabled={busy} onPress={() => setSharing(true)} />
        <ToolbarAction
          icon="trash"
          label="Trash"
          danger
          disabled={busy}
          onPress={() => setTrashing(true)}
        />
      </Dock>
    ) : null,
    [showing, ids.join(','), allFavorite, busy, error, serverUrl],
  );

  if (!showing) return null;

  return (
    <>
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

      <ShareSheet
        open={sharing}
        serverUrl={serverUrl}
        assetIds={ids}
        busy={busy}
        onClose={() => setSharing(false)}
        onShare={(userIds) =>
          run(async () => {
            await actions.share(serverUrl, ids, userIds);
            setSharing(false);
          })
        }
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
 * Kept beside its server-side twin so the two stay one thing: a selection
 * raises a panel offering what can be done with what is picked. The verbs
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
  const { setActive } = useSelectionBar();
  const showing = ids.length > 0;
  useEffect(() => {
    setActive(showing);
    return () => setActive(false);
  }, [showing, setActive]);

  useSelectionDock(
    showing ? (
      <Dock count={ids.length} onClear={onClear}>
        {/* Nothing left to send is worth saying rather than hiding: the tick is
            why removing them from the phone is safe. */}
        <ToolbarAction
          icon={pending === 0 ? 'cloud-done' : 'backup'}
          label={pending === 0 ? 'Backed up' : `Back up ${pending}`}
          disabled={busy || pending === 0}
          onPress={onBackUp}
        />
        <ToolbarAction
          icon="trash"
          label="Remove"
          danger
          disabled={busy}
          onPress={onRemove}
        />
      </Dock>
    ) : null,
    [showing, ids.join(','), pending, busy],
  );

  return null;
}

/**
 * The toolbar a selection raises, in the tab bar's place.
 *
 * Apple's guidance is that a tab bar and a toolbar never share a view: one
 * switches between sections of the app, the other acts on what is selected, and
 * the toolbar arrives with the selection and leaves when it is cleared. So the
 * tab bar hides — `SelectionProvider` carries that flag to the tabs layout —
 * and this stands where it was, rather than on top of it.
 *
 * Each action is a glyph over its own word, the way the tab bar's own items
 * are. A row of bare icons was what this used to be, and "move" and "who is
 * this" are not glyphs anyone should have to guess at.
 *
 * The count is not repeated here: the bar at the top of the screen already says
 * how many are picked, and this is where the verbs go.
 */
function Dock({
  error,
  onClear,
  children,
}: {
  count: number;
  error?: string | null;
  onClear: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: insets.bottom,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        zIndex: 30,
      }}
    >
      {error && (
        <Text
          style={{
            color: colors.danger,
            fontSize: 13.5,
            lineHeight: 19,
            paddingHorizontal: 18,
            paddingTop: 10,
          }}
        >
          {error}
        </Text>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 }}>
        <ToolbarAction icon="close" label="Cancel" onPress={onClear} />
        {children}
      </View>
    </View>
  );
}

/** One verb in the toolbar: a glyph over its own word. */
function ToolbarAction({
  icon,
  label,
  onPress,
  danger,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const tint = disabled ? colors.faint : danger ? colors.danger : colors.text;

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      radius={radius.md}
      label={label}
      style={{ flex: 1 }}
    >
      <View style={{ alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 2 }}>
        <Icon name={icon} size={22} color={tint} />
        <Text numberOfLines={1} style={{ color: tint, fontSize: 11, fontWeight: '600' }}>
          {label}
        </Text>
      </View>
    </Touchable>
  );
}
