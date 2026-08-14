import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { AlbumCard, FolderCard, Section } from '../components/Cards';
import { Header, HeaderAction, useHeaderClearance } from '../components/Header';
import type { IconName } from '../components/Icon';
import { useHeaderSlot } from '../header';
import { PhotoActions } from '../components/PhotoActions';
import { Segmented } from '../components/Segmented';
import { PlacesBody } from './PlacesScreen';
import { SharingShelf } from './SharingScreen';
import { ConfirmSheet, MoveSheet, PromptSheet, ShareSheet } from '../components/sheets';
import { Sheet, SheetRow } from '../components/ui';
import { actions } from '../lib/actions';
import { usePagedResource, useResource, type Album, type Asset, type Device, type FolderContents } from '../lib/api';
import { useRouter } from 'expo-router';
import { colors } from '../theme';

interface Props {
  /** Where this screen publishes its bar; unset when it is the Browse tab. */
  slot?: string;
  serverUrl: string;
  /** Null browses the top level, which is also the Imadeo tab itself. */
  folderId: string | null;
  title?: string;
  onBack?: () => void;
}

type Shelf = 'photos' | 'folders' | 'albums' | 'places' | 'sharing';

/** Whatever a long press landed on. */
type Target = { kind: 'folder' | 'album'; id: string; name: string; shared?: boolean };

/**
 * Everything on the server: the whole timeline, the folder tree, the albums.
 *
 * One screen serves the top level and every folder below it, because a folder's
 * contents and the root's contents are the same three things — sub-folders,
 * albums, and the photos filed directly here. The only difference is which id
 * was asked for, so splitting them would mean maintaining one layout twice.
 *
 * The Photos shelf only exists at the root. Inside a folder the photos are
 * already the bottom half of the screen, and a shelf that showed the entire
 * library from within one folder would be lying about where you are.
 */
export function BrowseScreen({ serverUrl, folderId, title, slot, onBack }: Props) {
  const router = useRouter();
  const atRoot = folderId === null;

  const [shelf, setShelf] = useState<Shelf>('photos');
  const selection = useSelection();

  const [creating, setCreating] = useState<'folder' | 'album' | null>(null);
  const [menuFor, setMenuFor] = useState<Target | null>(null);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [moving, setMoving] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [sharingFolder, setSharingFolder] = useState<Target | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const showing: Shelf = atRoot ? shelf : 'folders';

  // Three questions, one of which is live at a time. The other two are handed a
  // null path, which `useResource` treats as "do not ask".
  const timeline = usePagedResource<Asset>(
    serverUrl,
    /**
     * Newest upload first, not newest photograph first.
     *
     * This shelf answers "what is on my server", and the thing worth seeing at
     * the top is what arrived most recently. Sorting by capture date buried a
     * fresh backup of an old camera roll somewhere in the middle, so a backup
     * that had just finished looked as though nothing had happened.
     */
    atRoot && showing === 'photos' ? '/assets?sortBy=date&order=desc' : null,
  );
  const allAlbums = useResource<Album[]>(
    serverUrl,
    atRoot && showing === 'albums' ? '/albums' : null,
  );
  /**
   * At the top level this asks for a single asset it will not draw.
   *
   * The root's loose photos are already in the Photos shelf next door, along
   * with every other photo on the server — repeating them under the folder list
   * says nothing new and buries the folders under a screen of tiles. The
   * endpoint returns them regardless, so `size=1` is how little it can be asked
   * to send. Inside a folder the photos are the point, and come back in full.
   */
  const contents = useResource<FolderContents>(
    serverUrl,
    showing !== 'folders' ? null : atRoot ? '/folders/root?size=1' : `/folders/${folderId}/contents`,
  );
  const devices = useResource<Device[]>(
    serverUrl,
    atRoot && showing === 'folders' ? '/devices' : null,
  );

  const active =
    showing === 'photos' ? timeline : showing === 'albums' ? allAlbums : contents;
  const { token, error, loading } = active;

  const reload = useCallback(() => {
    timeline.reload();
    allAlbums.reload();
    contents.reload();
    devices.reload();
  }, [timeline.reload, allAlbums.reload, contents.reload, devices.reload]);

  const folders = showing === 'folders' ? contents.data?.folders ?? [] : [];
  const albums =
    showing === 'albums' ? allAlbums.data ?? [] : showing === 'folders' ? contents.data?.albums ?? [] : [];
  const assets =
    showing === 'photos'
      ? timeline.items
      : showing === 'folders' && !atRoot
        ? contents.data?.assets ?? []
        : [];

  const total =
    showing === 'photos'
      ? timeline.pagination?.total ?? null
      : contents.data?.pagination?.total ?? null;

  const trail = contents.data?.breadcrumbs ?? [];
  const subtitle = onBack
    ? trail.slice(0, -1).map((crumb) => crumb.name).join(' / ') || 'Browse'
    : atRoot && total !== null && showing === 'photos'
      ? `${total.toLocaleString()} on your server`
      : atRoot && showing === 'sharing'
        ? 'Shared with you'
      : undefined;

  const clearance = useHeaderClearance(atRoot ? 54 : 0);

  /**
   * What belongs in the bar, wherever the bar happens to be.
   *
   * As a tab it is handed to the shell, which owns the one persistent bar; as a
   * pushed folder this screen covers the shell entirely and draws it itself.
   */
  const bar = {
    title: title ?? 'Browse',
    subtitle,
    icon: (onBack
      ? 'folder'
      : showing === 'photos'
        ? 'library'
        : showing === 'albums'
          ? 'album'
          : showing === 'sharing'
            ? 'shared'
          : 'browse') as IconName,
    action:
      showing === 'folders' || showing === 'albums' ? (
        <HeaderAction
          label="New"
          icon="plus"
          onPress={() => setCreating(showing === 'albums' ? 'album' : 'folder')}
        />
      ) : undefined,
    below: atRoot ? (
      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <Segmented
          segments={[
            { id: 'photos', label: 'Photos', icon: 'library' },
            { id: 'folders', label: 'Folders', icon: 'folder' },
            { id: 'albums', label: 'Albums', icon: 'album' },
            { id: 'places', label: 'Places', icon: 'pin' },
            { id: 'sharing', label: 'Sharing', icon: 'shared' },
          ]}
          active={shelf}
          onChange={(next) => {
            selection.clear();
            setShelf(next);
          }}
        />
      </View>
    ) : undefined,
  };

  // One slot or the other: `browse` as a tab, the stack's own key as a folder.
  // Either way the shell draws it, and this screen never carries a bar of its
  // own across the top of the one already there.
  useHeaderSlot(
    slot ?? 'browse',
    { ...bar, onBack },
    [title, subtitle, showing, shelf, atRoot, onBack],
  );
  const deviceShelf = atRoot && showing === 'folders';
  const nothing = folders.length === 0 && albums.length === 0 && assets.length === 0 && !deviceShelf;

  /** Runs a write, then refetches whichever shelf is showing. */
  const run = async (work: () => Promise<unknown>) => {
    setFailure(null);
    try {
      await work();
      reload();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'That did not work.');
    }
  };

  const header = (
    <View style={{ paddingTop: 16 }}>
      {(error || failure) && (
        <Text
          style={{
            color: colors.danger,
            fontSize: 14,
            lineHeight: 20,
            paddingHorizontal: 16,
            marginBottom: 16,
          }}
        >
          {error ?? failure}
        </Text>
      )}

      {deviceShelf && (
        <Section title="Devices" trailing={`${devices.data?.length ?? 0}`}>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <FolderCard
              folder={{ name: 'Devices', cardIcon: 'phone' }}
              detail={`${devices.data?.length ?? 0} device ${(devices.data?.length ?? 0) === 1 ? 'library' : 'libraries'}`}
              onPress={() => router.push('/devices')}
            />
          </View>
        </Section>
      )}

      {folders.length > 0 && (
        <Section title="Folders" trailing={`${folders.length}`}>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {folders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onPress={() => router.push({ pathname: '/folder/[id]', params: { id: folder.id, title: folder.name } })}
                  onLongPress={() =>
                  setMenuFor({ kind: 'folder', id: folder.id, name: folder.name, shared: folder.shared })
                }
              />
            ))}
          </View>
        </Section>
      )}

      {albums.length > 0 && (
        <Section title="Albums" trailing={`${albums.length}`}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12 }}>
            {albums.map((album) => (
              // Two to a row, with the gap taken out of each card's share.
              <View key={album.id} style={{ width: '47.5%' }}>
                <AlbumCard
                  serverUrl={serverUrl}
                  album={album}
                  token={token}
                  onPress={() => router.push({ pathname: '/album/[id]', params: { id: album.id, title: album.name } })}
                  onLongPress={() => setMenuFor({ kind: 'album', id: album.id, name: album.name })}
                />
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* Labels the grid the list draws below this header, so loose photos are
          not mistaken for the contents of the album above them. */}
      {assets.length > 0 && showing === 'folders' && (
        <Section title="Photos" trailing={total ? total.toLocaleString() : undefined} />
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/*
        Places replaces the grid rather than sitting above it.

        It is a map and a set of covers, not a wall of photographs, so there is
        no grid for it to share — the shelf is a different shape from the other
        three and pretending otherwise would mean an empty grid under a map.
      */}
      {showing === 'places' ? (
        <PlacesBody serverUrl={serverUrl} topInset={clearance} />
      ) : showing === 'sharing' ? (
        <SharingShelf serverUrl={serverUrl} topInset={clearance} />
      ) : (
      <AssetGrid
        /*
         * The library scrolled for minutes is nothing but days, so it says so.
         *
         * A folder and a set of search results are photographs that answer one
         * question, and when each was taken is beside the point there — they
         * keep the plain grid.
         */
        groupByDay={atRoot && showing === 'photos'}
        serverUrl={serverUrl}
        assets={assets}
        token={token}
        loading={loading}
        onRefresh={reload}
        topInset={clearance}
        header={nothing ? null : header}
        showEmptyState={nothing}
        selected={selection.ids}
        onToggle={selection.toggle}
        onToggleDay={selection.toggleMany}
        onStartSelecting={selection.start}
        onChanged={reload}
        hasMore={showing === 'photos' && timeline.hasMore}
        loadingMore={showing === 'photos' && timeline.loadingMore}
        onLoadMore={showing === 'photos' ? timeline.loadMore : undefined}
        emptyIcon={showing === 'albums' ? 'album' : showing === 'photos' ? 'library' : 'folder'}
        emptyTitle={
          loading
            ? 'Loading…'
            : showing === 'albums'
              ? 'No albums yet'
              : showing === 'photos'
                ? 'Nothing on your server yet'
                : atRoot
                  ? 'Nothing filed yet'
                  : 'This folder is empty'
        }
        emptyBody={
          showing === 'albums'
            ? 'Albums group photos without moving them out of their folders. Tap New to make one.'
            : showing === 'photos'
              ? 'Back up some photos from the Library tab and they will appear here.'
              : 'Folders and albums you create appear here, along with anything not filed into one.'
        }
      />
      )}

      <PhotoActions
        serverUrl={serverUrl}
        ids={selection.ids}
        allFavorite={
          selection.ids.length > 0 &&
          selection.ids.every((id) => assets.find((a) => a.id === id)?.isFavorite)
        }
        onClear={selection.clear}
        onDone={() => {
          selection.clear();
          reload();
        }}
      />

      {/* -- folder and album actions ------------------------------------- */}

      <Sheet
        open={menuFor !== null}
        title={menuFor?.name ?? ''}
        description={menuFor?.kind === 'folder' ? 'Folder' : 'Album'}
        onClose={() => setMenuFor(null)}
      >
        {menuFor?.kind === 'folder' && !menuFor.shared && <SheetRow
          icon="shared"
          label="Share folder"
          hint="View-only access"
          onPress={() => {
            setSharingFolder(menuFor);
            setMenuFor(null);
          }}
        />}
        {!menuFor?.shared && <SheetRow
          icon="edit"
          label="Rename"
          onPress={() => {
            setRenaming(menuFor);
            setMenuFor(null);
          }}
        />}
        {!menuFor?.shared && <SheetRow
          icon="move"
          label="Move to…"
          hint="Another folder"
          onPress={() => {
            setMoving(menuFor);
            setMenuFor(null);
          }}
        />}
        {!menuFor?.shared && <SheetRow
          icon="trash"
          label={menuFor?.kind === 'folder' ? 'Delete folder' : 'Delete album'}
          danger
          onPress={() => {
            setDeleting(menuFor);
            setMenuFor(null);
          }}
        />}
      </Sheet>

      <ShareSheet
        open={sharingFolder !== null}
        serverUrl={serverUrl}
        itemCount={1}
        title={`Share “${sharingFolder?.name ?? ''}”`}
        description="People you choose can view this folder, its albums, and everything inside it. They cannot change your library."
        confirmLabel="Share folder"
        onClose={() => setSharingFolder(null)}
        onShare={(userIds) =>
          run(() => actions.shareFolder(serverUrl, sharingFolder!.id, userIds)).then(() => setSharingFolder(null))
        }
      />

      <PromptSheet
        open={creating !== null}
        title={creating === 'album' ? 'New album' : 'New folder'}
        description={
          creating === 'album'
            ? 'Albums group photos without moving them out of their folders.'
            : undefined
        }
        placeholder={creating === 'album' ? 'Best of the trip' : 'Holidays'}
        confirmLabel="Create"
        onClose={() => setCreating(null)}
        onSubmit={(name) =>
          run(() =>
            creating === 'album'
              ? actions.createAlbum(serverUrl, name, folderId)
              : actions.createFolder(serverUrl, name, folderId),
          )
        }
      />

      <PromptSheet
        open={renaming !== null}
        title={renaming?.kind === 'folder' ? 'Rename folder' : 'Rename album'}
        placeholder="Name"
        initial={renaming?.name ?? ''}
        confirmLabel="Rename"
        onClose={() => setRenaming(null)}
        onSubmit={(name) =>
          run(() =>
            renaming?.kind === 'folder'
              ? actions.renameFolder(serverUrl, renaming.id, name)
              : actions.renameAlbum(serverUrl, renaming!.id, name),
          )
        }
      />

      <MoveSheet
        open={moving !== null}
        serverUrl={serverUrl}
        count={1}
        // A folder or an album can only be filed under a folder, never inside
        // an album — an album holds photos, not containers.
        allowAlbums={false}
        excludeFolderId={moving?.kind === 'folder' ? moving.id : undefined}
        onClose={() => setMoving(null)}
        onFolder={(destination) =>
          run(() =>
            moving?.kind === 'folder'
              ? actions.moveFolder(serverUrl, moving.id, destination)
              : actions.moveAlbum(serverUrl, moving!.id, destination),
          )
        }
        onAlbum={() => {}}
      />

      <ConfirmSheet
        open={deleting !== null}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={
          deleting?.kind === 'folder'
            ? 'The folder, its sub-folders, albums and photos move to Trash and can be restored together for 30 days.'
            : 'The album moves to Trash. Its photos stay in your library.'
        }
        confirmLabel={deleting?.kind === 'folder' ? 'Delete folder' : 'Delete album'}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          run(() =>
            deleting?.kind === 'folder'
              ? actions.deleteFolder(serverUrl, deleting.id)
              : actions.deleteAlbum(serverUrl, deleting!.id),
          )
        }
      />
    </View>
  );
}
