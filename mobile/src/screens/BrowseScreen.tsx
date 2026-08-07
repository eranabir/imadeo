import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { AlbumCard, FolderCard, Section } from '../components/Cards';
import { Header, HeaderAction, useHeaderClearance } from '../components/Header';
import { PhotoActions } from '../components/PhotoActions';
import { Segmented } from '../components/Segmented';
import { ConfirmSheet, MoveSheet, PromptSheet } from '../components/sheets';
import { Sheet, SheetRow } from '../components/ui';
import { actions } from '../lib/actions';
import { useResource, type Album, type Asset, type FolderContents, type Paged } from '../lib/api';
import { useNavigation } from '../navigation';
import { colors } from '../theme';

interface Props {
  serverUrl: string;
  /** Null browses the top level, which is also the Imadeo tab itself. */
  folderId: string | null;
  title?: string;
  onBack?: () => void;
}

type Shelf = 'photos' | 'folders' | 'albums';

/** Whatever a long press landed on. */
type Target = { kind: 'folder' | 'album'; id: string; name: string };

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
export function BrowseScreen({ serverUrl, folderId, title, onBack }: Props) {
  const { push } = useNavigation();
  const atRoot = folderId === null;

  const [shelf, setShelf] = useState<Shelf>('photos');
  const selection = useSelection();

  const [creating, setCreating] = useState<'folder' | 'album' | null>(null);
  const [menuFor, setMenuFor] = useState<Target | null>(null);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [moving, setMoving] = useState<Target | null>(null);
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const showing: Shelf = atRoot ? shelf : 'folders';

  // Three questions, one of which is live at a time. The other two are handed a
  // null path, which `useResource` treats as "do not ask".
  const timeline = useResource<Paged<Asset>>(
    serverUrl,
    /**
     * Newest upload first, not newest photograph first.
     *
     * This shelf answers "what is on my server", and the thing worth seeing at
     * the top is what arrived most recently. Sorting by capture date buried a
     * fresh backup of an old camera roll somewhere in the middle, so a backup
     * that had just finished looked as though nothing had happened.
     */
    atRoot && showing === 'photos' ? '/assets?size=300&sortBy=added&order=desc' : null,
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

  const active =
    showing === 'photos' ? timeline : showing === 'albums' ? allAlbums : contents;
  const { token, error, loading } = active;

  const reload = useCallback(() => {
    timeline.reload();
    allAlbums.reload();
    contents.reload();
  }, [timeline.reload, allAlbums.reload, contents.reload]);

  const folders = showing === 'folders' ? contents.data?.folders ?? [] : [];
  const albums =
    showing === 'albums' ? allAlbums.data ?? [] : showing === 'folders' ? contents.data?.albums ?? [] : [];
  const assets =
    showing === 'photos'
      ? timeline.data?.items ?? []
      : showing === 'folders' && !atRoot
        ? contents.data?.assets ?? []
        : [];

  const total =
    showing === 'photos'
      ? timeline.data?.pagination?.total ?? null
      : contents.data?.pagination?.total ?? null;

  const trail = contents.data?.breadcrumbs ?? [];
  const subtitle = onBack
    ? trail.slice(0, -1).map((crumb) => crumb.name).join(' / ') || 'Browse'
    : atRoot && total !== null && showing === 'photos'
      ? `${total.toLocaleString()} on your server`
      : undefined;

  const clearance = useHeaderClearance(atRoot ? 54 : 0);
  const nothing = folders.length === 0 && albums.length === 0 && assets.length === 0;

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

      {folders.length > 0 && (
        <Section title="Folders" trailing={`${folders.length}`}>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {folders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                onPress={() => push({ name: 'folder', id: folder.id, title: folder.name })}
                onLongPress={() =>
                  setMenuFor({ kind: 'folder', id: folder.id, name: folder.name })
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
                  onPress={() => push({ name: 'album', id: album.id, title: album.name })}
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
      <Header
        title={title ?? 'Browse'}
        subtitle={subtitle}
        icon={onBack ? 'folder' : showing === 'photos' ? 'library' : showing === 'albums' ? 'album' : 'browse'}
        onBack={onBack}
        action={
          showing === 'photos' ? undefined : (
            <HeaderAction
              label="New"
              icon="plus"
              onPress={() => setCreating(showing === 'albums' ? 'album' : 'folder')}
            />
          )
        }
      >
        {atRoot && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <Segmented
              segments={[
                { id: 'photos', label: 'Photos', icon: 'library' },
                { id: 'folders', label: 'Folders', icon: 'folder' },
                { id: 'albums', label: 'Albums', icon: 'album' },
              ]}
              active={shelf}
              onChange={(next) => {
                selection.clear();
                setShelf(next);
              }}
            />
          </View>
        )}
      </Header>

      <AssetGrid
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
        onStartSelecting={selection.start}
        onChanged={reload}
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
        <SheetRow
          icon="edit"
          label="Rename"
          onPress={() => {
            setRenaming(menuFor);
            setMenuFor(null);
          }}
        />
        <SheetRow
          icon="move"
          label="Move to…"
          hint="Another folder"
          onPress={() => {
            setMoving(menuFor);
            setMenuFor(null);
          }}
        />
        <SheetRow
          icon="trash"
          label={menuFor?.kind === 'folder' ? 'Delete folder' : 'Delete album'}
          danger
          onPress={() => {
            setDeleting(menuFor);
            setMenuFor(null);
          }}
        />
      </Sheet>

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
            ? 'Sub-folders go with it and the photos inside move to the trash, where they can be restored for 30 days.'
            : 'The album is removed. The photos inside it stay in your library.'
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
