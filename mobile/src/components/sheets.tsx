import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
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

interface SharePeer {
  id: string;
  name: string;
  email: string;
}

/** Gives other signed-in accounts read-only access to selected server photos. */
export function ShareSheet({
  open,
  serverUrl,
  assetIds = [],
  itemCount,
  title,
  description,
  confirmLabel = 'Share privately',
  busy,
  onShare,
  onClose,
}: {
  open: boolean;
  serverUrl: string;
  assetIds?: string[];
  itemCount?: number;
  title?: string;
  description?: string;
  confirmLabel?: string;
  busy?: boolean;
  onShare: (userIds: string[]) => void;
  onClose: () => void;
}) {
  const peers = useResource<SharePeer[]>(serverUrl, open ? '/users' : null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) setSelected(new Set());
  }, [open]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const count = itemCount ?? assetIds.length;
  return (
    <Sheet
      open={open}
      tall
      title={title ?? `Share ${count === 1 ? 'photo' : `${count} photos`}`}
      description={description ?? 'Choose who can view these files. Shared photos stay read-only and can be revoked by you at any time.'}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button
            label={busy ? 'Sharing…' : confirmLabel}
            icon="shared"
            disabled={!selected.size || busy}
            onPress={() => onShare([...selected])}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
        {peers.loading ? (
          <Text style={{ color: colors.muted, fontSize: 15 }}>Loading accounts…</Text>
        ) : peers.data?.length ? (
          peers.data.map((person) => {
            const checked = selected.has(person.id);
            return (
              <Touchable
                key={person.id}
                role="radio"
                selected={checked}
                label={`Share with ${person.name}`}
                radius={radius.md}
                onPress={() => toggle(person.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 13,
                  backgroundColor: checked ? colors.surface : colors.bg,
                  borderWidth: 1,
                  borderColor: checked ? colors.primary : colors.border,
                }}
              >
                <View
                  style={{
                    width: 21,
                    height: 21,
                    borderRadius: radius.sm,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: checked ? colors.primary : colors.border,
                    backgroundColor: checked ? colors.primary : 'transparent',
                  }}
                >
                  {checked && <Icon name="check" size={13} color={colors.onPrimary} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{person.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{person.email}</Text>
                </View>
              </Touchable>
            );
          })
        ) : (
          <Text style={{ color: colors.muted, fontSize: 15 }}>There are no other accounts on this server yet.</Text>
        )}
      </ScrollView>
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
  const [needle, setNeedle] = useState('');
  /**
   * Folders the pointer has closed.
   *
   * Closed rather than open, so the tree arrives expanded — a move sheet that
   * needs three taps to reach a folder you already know the name of is worse
   * than a long list, and this is the escape hatch for when the list is the
   * long one.
   */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const tree = useResource<FolderRow[]>(serverUrl, open ? '/folders/tree' : null);
  const albums = useResource<Album[]>(serverUrl, open && allowAlbums ? '/albums' : null);

  // A sheet that stays open remembers what was typed into it last time, which is
  // never what is wanted the next time it is opened.
  useEffect(() => {
    if (!open) {
      setNeedle('');
      setClosed(new Set());
    }
  }, [open]);

  const toggleFolder = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const query = needle.trim().toLowerCase();
  const hit = (name: string) => !query || name.toLowerCase().includes(query);

  /**
   * One tree, with the albums standing where they actually live.
   *
   * An album belongs to a folder — that is what `folderId` is — so listing the
   * two apart described a structure the library does not have, and left you
   * scrolling a flat list of forty albums to find the one you had just been
   * looking at inside a folder. Here a folder is followed by its own albums and
   * then by its subfolders, which is the order they appear in Browse.
   */
  const inFolder = (folderId: string | null) =>
    (albums.data ?? []).filter((album) => (album.folderId ?? null) === folderId);

  type Row =
    | { kind: 'folder'; depth: number; folder: FolderRow; holds: boolean; trail: string }
    | { kind: 'album'; depth: number; album: Album; trail: string };

  /**
   * Where a row sits, written out in names.
   *
   * The folder's own `path` field is a chain of uuids — fine for the server,
   * meaningless to read — so the ancestors' names are carried down the walk
   * instead. It only shows while searching, when the indentation that would
   * otherwise say this has been flattened away.
   */
  const walk = (nodes: FolderRow[], depth = 0, trail: string[] = []): Row[] =>
    nodes.flatMap((node) => {
      if (node.id === excludeFolderId) return [];

      const albumsHere = inFolder(node.id);
      const children = node.children ?? [];
      const holds = albumsHere.length > 0 || children.length > 0;
      const under = [...trail, node.name];

      return [
        { kind: 'folder' as const, depth, folder: node, holds, trail: trail.join(' / ') },
        ...(closed.has(node.id)
          ? []
          : [
              ...albumsHere.map((album) => ({
                kind: 'album' as const,
                depth: depth + 1,
                album,
                trail: under.join(' / '),
              })),
              ...walk(children, depth + 1, under),
            ]),
      ];
    });

  /**
   * A search narrows the tree, so nesting stops meaning anything.
   *
   * Indentation says "inside the row above"; once that row has been filtered
   * out, the same indentation says something untrue. Matches are shown flat,
   * with the folder's path as the hint so two same-named folders still read
   * apart.
   */
  const all: Row[] = [
    ...walk(tree.data ?? []),
    // Albums filed nowhere sit at the root, beside the top-level folders.
    ...inFolder(null).map((album) => ({ kind: 'album' as const, depth: 0, album, trail: '' })),
  ];

  const rows = query
    ? all
        .filter((row) => hit(row.kind === 'folder' ? row.folder.name : row.album.name))
        .map((row) => ({ ...row, depth: 0 }))
    : all;

  const subject = count === 1 ? 'this item' : `these ${count} items`;
  const loading = tree.loading || albums.loading;

  return (
    <Sheet
      open={open}
      title="Move to…"
      description={`Where ${subject} should go.`}
      tall
      onClose={onClose}
      footer={<Button label="Cancel" variant="secondary" onPress={onClose} />}
    >
      {/* Typing narrows folders and albums together — picking a destination
          means knowing its name, rarely which of the two kinds it is. */}
      {/* The list is what this sheet is for; the field is there for when it is
          long. Opening straight into a keyboard would cover most of it. */}
      <Field
        value={needle}
        onChange={setNeedle}
        autoFocus={false}
        placeholder={allowAlbums ? 'Find a folder or album' : 'Find a folder'}
      />

      <View style={{ height: 12 }} />

      {!query && (
        <Destination
          icon="library"
          label="Top level"
          hint="Not filed in any folder"
          onPress={() => {
            onFolder(null);
            onClose();
          }}
        />
      )}

      <View style={{ gap: 2 }}>
        {rows.map((row) =>
          row.kind === 'folder' ? (
            <Destination
              key={`folder-${row.folder.id}`}
              icon="folder"
              label={row.folder.name}
              hint={query ? row.trail || undefined : undefined}
              indent={row.depth}
              // Searching flattens the tree, so there is nothing left to fold.
              folded={query || !row.holds ? undefined : closed.has(row.folder.id)}
              onToggle={() => toggleFolder(row.folder.id)}
              onPress={() => {
                onFolder(row.folder.id);
                onClose();
              }}
            />
          ) : (
            <Destination
              key={`album-${row.album.id}`}
              icon="album"
              label={row.album.name}
              hint={
                query && row.trail
                  ? `${row.trail} · ${row.album.assetCount.toLocaleString()} photos`
                  : `${row.album.assetCount.toLocaleString()} photos`
              }
              indent={row.depth}
              onPress={() => {
                onAlbum(row.album.id);
                onClose();
              }}
            />
          ),
        )}
      </View>

      {loading && <Text style={{ color: colors.faint, padding: 12 }}>Loading…</Text>}
      {!loading && rows.length === 0 && query && (
        <Text style={{ color: colors.faint, padding: 12 }}>
          Nothing here is called “{needle.trim()}”.
        </Text>
      )}
    </Sheet>
  );
}

function Destination({
  icon,
  label,
  hint,
  indent = 0,
  folded,
  onToggle,
  onPress,
}: {
  icon: 'folder' | 'album' | 'library';
  label: string;
  hint?: string;
  indent?: number;
  /** Whether what is inside is hidden. Undefined means nothing folds here. */
  folded?: boolean;
  onToggle?: () => void;
  onPress: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        // Nesting is the only thing that tells two folders of the same name
        // in different places apart.
        paddingLeft: indent * 16,
      }}
    >
      {/*
        Its own target, beside the row rather than inside it.

        Opening a folder and choosing it are different intentions, and a chevron
        that also picked the folder would file the photos in whichever folder you
        were trying to look inside.
      */}
      {folded === undefined ? (
        <View style={{ width: 28 }} />
      ) : (
        <Touchable
          onPress={onToggle}
          radius={radius.pill}
          label={folded ? `Open ${label}` : `Close ${label}`}
        >
          <View style={{ width: 28, height: 34, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ transform: [{ rotate: folded ? '0deg' : '90deg' }] }}>
              <Icon name="forward" size={15} color={colors.muted} strong />
            </View>
          </View>
        </Touchable>
      )}

      <Touchable onPress={onPress} radius={radius.md} label={label} style={{ flex: 1 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
            paddingVertical: 12,
            paddingRight: 12,
            paddingLeft: 4,
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
    </View>
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
                source={faceThumbnail(serverUrl, person.id, token, person.thumbnailUpdatedAt)}
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
