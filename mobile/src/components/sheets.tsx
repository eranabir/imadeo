import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { actions } from '../lib/actions';
import { faceThumbnail, useResource, type Album, type Person } from '../lib/api';
import { colors, radius } from '../theme';
import { Icon } from './Icon';
import { Button, Chip, Sheet, Touchable } from './ui';

/** The shared field style, so every sheet's input looks like the same control. */
function Field({
  value,
  onChange,
  placeholder,
  onSubmit,
  autoFocus = true,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      placeholderTextColor={colors.faint}
      autoFocus={autoFocus}
      autoCorrect={false}
      returnKeyType="done"
      onSubmitEditing={onSubmit}
      style={{
        color: colors.text,
        fontSize: 17,
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: focused ? colors.primary : colors.border,
        backgroundColor: colors.bg,
      }}
    />
  );
}

/** Asks for one piece of text — a new name, a new folder. */
export function PromptSheet({
  open,
  title,
  description,
  placeholder,
  initial = '',
  confirmLabel = 'Save',
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  placeholder: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);

  // The sheet is kept mounted between uses, so the previous answer would still
  // be in the box the next time it opens.
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Sheet
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button label={confirmLabel} onPress={submit} disabled={!value.trim()} style={{ flex: 1 }} />
        </View>
      }
    >
      <Field value={value} onChange={setValue} placeholder={placeholder} onSubmit={submit} />
    </Sheet>
  );
}

/** Confirms something that cannot be undone with a tap. */
export function ConfirmSheet({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button
            label={confirmLabel}
            variant="danger"
            onPress={() => {
              onConfirm();
              onClose();
            }}
            style={{ flex: 1, borderWidth: 1, borderColor: colors.danger }}
          />
        </View>
      }
    >
      <View />
    </Sheet>
  );
}

interface FolderRow {
  id: string;
  name: string;
  path: string;
  depth: number;
  children: FolderRow[];
}

/**
 * Picks where something goes.
 *
 * The whole tree arrives in one request and is flattened here rather than
 * expanded a level at a time. A move dialog that needs three taps to reach a
 * folder you already know the name of is worse than a long list.
 */
export function MoveSheet({
  open,
  serverUrl,
  count,
  /** Albums only accept photos, so folders and albums cannot be filed into one. */
  allowAlbums,
  /** A folder cannot be moved inside itself. */
  excludeFolderId,
  onFolder,
  onAlbum,
  onClose,
}: {
  open: boolean;
  serverUrl: string;
  count: number;
  allowAlbums: boolean;
  excludeFolderId?: string;
  onFolder: (folderId: string | null) => void;
  onAlbum: (albumId: string) => void;
  onClose: () => void;
}) {
  const [where, setWhere] = useState<'folder' | 'album'>('folder');
  const tree = useResource<FolderRow[]>(serverUrl, open ? '/folders/tree' : null);
  const albums = useResource<Album[]>(serverUrl, open && allowAlbums ? '/albums' : null);

  useEffect(() => {
    if (!allowAlbums) setWhere('folder');
  }, [allowAlbums]);

  const flatten = (nodes: FolderRow[], depth = 0): { row: FolderRow; depth: number }[] =>
    nodes.flatMap((node) =>
      node.id === excludeFolderId
        ? []
        : [{ row: node, depth }, ...flatten(node.children ?? [], depth + 1)],
    );

  const folders = flatten(tree.data ?? []);
  const subject = count === 1 ? 'this item' : `these ${count} items`;

  return (
    <Sheet
      open={open}
      title="Move to…"
      description={`Where ${subject} should go.`}
      onClose={onClose}
      footer={<Button label="Cancel" variant="secondary" onPress={onClose} />}
    >
      {allowAlbums && (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <Chip
            label="A folder"
            icon="folder"
            active={where === 'folder'}
            onPress={() => setWhere('folder')}
          />
          <Chip
            label="An album"
            icon="album"
            active={where === 'album'}
            onPress={() => setWhere('album')}
          />
        </View>
      )}

      {where === 'folder' ? (
        <View style={{ gap: 2 }}>
          <Destination
            icon="library"
            label="Top level"
            hint="Not filed in any folder"
            onPress={() => {
              onFolder(null);
              onClose();
            }}
          />
          {folders.map(({ row, depth }) => (
            <Destination
              key={row.id}
              icon="folder"
              label={row.name}
              indent={depth}
              onPress={() => {
                onFolder(row.id);
                onClose();
              }}
            />
          ))}
          {tree.loading && <Text style={{ color: colors.faint, padding: 12 }}>Loading…</Text>}
        </View>
      ) : (
        <View style={{ gap: 2 }}>
          {(albums.data ?? []).map((album) => (
            <Destination
              key={album.id}
              icon="album"
              label={album.name}
              hint={`${album.assetCount.toLocaleString()} photos`}
              onPress={() => {
                onAlbum(album.id);
                onClose();
              }}
            />
          ))}
          {albums.loading && <Text style={{ color: colors.faint, padding: 12 }}>Loading…</Text>}
        </View>
      )}
    </Sheet>
  );
}

function Destination({
  icon,
  label,
  hint,
  indent = 0,
  onPress,
}: {
  icon: 'folder' | 'album' | 'library';
  label: string;
  hint?: string;
  indent?: number;
  onPress: () => void;
}) {
  return (
    <Touchable onPress={onPress} radius={radius.md} label={label}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          paddingVertical: 12,
          paddingHorizontal: 12,
          // Nesting is the only thing that tells two folders of the same name
          // in different places apart.
          paddingLeft: 12 + indent * 16,
        }}
      >
        <Icon name={icon} size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15.5, fontWeight: '600' }}>
            {label}
          </Text>
          {hint && <Text style={{ color: colors.faint, fontSize: 12 }}>{hint}</Text>}
        </View>
      </View>
    </Touchable>
  );
}

/**
 * Says who is in the selected photos.
 *
 * Offers to create a new person or pet in the same sheet, because the case
 * where recognition missed someone entirely is the case where naming them by
 * hand matters — and there would be nothing in the list to pick.
 */
export function AssignSheet({
  open,
  serverUrl,
  assetIds,
  onDone,
  onError,
  onClose,
}: {
  open: boolean;
  serverUrl: string;
  assetIds: string[];
  onDone: () => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<'PERSON' | 'PET'>('PERSON');
  const [creating, setCreating] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, token } = useResource<Person[]>(
    serverUrl,
    open ? `/people?kind=${kind}&minFaces=1&withHidden=true&size=300` : null,
  );

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      setCreating('');
      onClose();
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const noun = kind === 'PET' ? 'pet' : 'person';

  return (
    <Sheet
      open={open}
      title={assetIds.length > 1 ? `Who is in these ${assetIds.length}?` : 'Who is in this photo?'}
      description={`Pick a ${noun}, or start a new one. Photos with nothing detected are simply marked as theirs.`}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Field
              value={creating}
              onChange={setCreating}
              placeholder={`A new ${noun}'s name`}
              autoFocus={false}
              onSubmit={() =>
                creating.trim() &&
                run(async () => {
                  const person = await actions.createSubject(serverUrl, creating.trim(), kind);
                  await actions.assignSubject(serverUrl, person.id, assetIds);
                })
              }
            />
          </View>
          <Button
            label="Create"
            icon="plus"
            disabled={!creating.trim()}
            busy={busy}
            onPress={() =>
              run(async () => {
                const person = await actions.createSubject(serverUrl, creating.trim(), kind);
                await actions.assignSubject(serverUrl, person.id, assetIds);
              })
            }
          />
        </View>
      }
    >
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        <Chip
          label="People"
          icon="person"
          active={kind === 'PERSON'}
          onPress={() => setKind('PERSON')}
        />
        <Chip label="Pets" icon="pet" active={kind === 'PET'} onPress={() => setKind('PET')} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {(data ?? []).map((person) => (
          <Touchable
            key={person.id}
            disabled={busy}
            radius={radius.md}
            label={person.name || 'Unnamed'}
            onPress={() => run(() => actions.assignSubject(serverUrl, person.id, assetIds))}
            style={{ width: 72 }}
          >
            <View style={{ alignItems: 'center', paddingVertical: 6 }}>
              <Image
                source={faceThumbnail(serverUrl, person.id, token)}
                style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface }}
                contentFit="cover"
                recyclingKey={person.id}
                transition={120}
              />
              <Text
                numberOfLines={1}
                style={{
                  color: person.name ? colors.text : colors.faint,
                  fontSize: 12,
                  fontWeight: '600',
                  marginTop: 6,
                  textAlign: 'center',
                }}
              >
                {person.name || 'Unnamed'}
              </Text>
            </View>
          </Touchable>
        ))}

        {(data ?? []).length === 0 && (
          <Text style={{ color: colors.faint, fontSize: 14, paddingVertical: 10 }}>
            No {noun === 'pet' ? 'pets' : 'people'} yet. Type a name below to start one.
          </Text>
        )}
      </View>
    </Sheet>
  );
}
