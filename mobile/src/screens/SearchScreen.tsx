import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Account } from '../components/Account';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { AlbumCard, FolderCard, SubjectCard, Section } from '../components/Cards';
import { Header, useHeaderClearance, type HeaderConfig } from '../components/Header';
import { Icon } from '../components/Icon';
import { PhotoActions } from '../components/PhotoActions';
import { SelectionDock } from '../components/SelectionDock';
import { Segmented } from '../components/Segmented';
import { useResource, type Asset, type Paged, type Subject } from '../lib/api';
import { useRouter } from 'expo-router';
import { colors, radius } from '../theme';

type Mode = 'smart' | 'people-and-pets' | 'places' | 'files';

interface Places {
  folders: { id: string; name: string; path: string }[];
  albums: { id: string; name: string; assetCount: number }[];
  items: Asset[];
}

interface Town {
  city: string | null;
  country: string | null;
  count: number;
  coverAssetId: string;
}

interface IndexStatus {
  total: number;
  indexed: number;
  available: boolean;
}

const SUGGESTIONS = ['beach', 'birthday cake', 'snow', 'dog on a sofa', 'sunset', 'passport'];

/**
 * Three different questions that all start with typing something.
 *
 * They are kept as separate modes rather than merged into one ranked list
 * because they disagree about what a match is. Content search will happily
 * return the twentieth-best picture of a beach; a filename search returning
 * anything other than the file asked for is simply wrong. Blending the two
 * makes both feel unreliable.
 */
export function SearchScreen({ serverUrl }: { serverUrl: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('smart');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  // Content search encodes the phrase on the server before it can look
  // anything up, so a request per keystroke would queue work for prefixes
  // nobody meant to search for.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 450);
    return () => clearTimeout(timer);
  }, [text]);

  const path = !query
    ? null
    : mode === 'smart'
      ? `/assets/search/context?text=${encodeURIComponent(query)}&size=200`
      : mode === 'places'
        ? `/assets/search/places?text=${encodeURIComponent(query)}`
        : mode === 'files'
          ? `/assets?filename=${encodeURIComponent(query)}&size=200&sortBy=date&order=desc`
          : null;

  const { data, token, error, loading, reload } = useResource<Paged<Asset> & Partial<Places>>(
    serverUrl,
    path,
  );

  /**
   * People and pets are matched here rather than on the server.
   *
   * There is no name-search endpoint for subjects, and a library holds tens of
   * them, not thousands — so the whole list comes down once and the typing
   * filters it locally. That also makes it instant, which a face picker should
   * be.
   */
  const subjects = useResource<Subject[]>(
    serverUrl,
    // `minFaces=1` for the same reason the People tab passes it: the server's
    // default minimum hides small groups, and a name you are searching for is
    // no less findable for belonging to one.
    mode === 'people-and-pets' ? '/people-and-pets?minFaces=1&size=500' : null,
  );

  /**
   * The towns and cities photos were taken in.
   *
   * Fetched whole and filtered here for the same reason the people list is:
   * there are a dozen of them, not thousands, and a round trip per keystroke
   * to narrow twelve rows is a round trip wasted.
   */
  const towns = useResource<Town[]>(serverUrl, mode === 'places' ? '/assets/places' : null);

  const needle = query.trim().toLowerCase();
  const matches = (subjects.data ?? []).filter(
    (subject) => !needle || subject.name.toLowerCase().includes(needle),
  );

  const placeMatches = (towns.data ?? []).filter(
    (town) =>
      !needle ||
      [town.city, town.country].filter(Boolean).join(', ').toLowerCase().includes(needle),
  );

  /**
   * How much of the library content search can actually see.
   *
   * Fetched once on entering the mode rather than when a search comes back
   * empty. Tying it to the empty result meant refetching on the gap between
   * the query changing and the request starting — once per search, for two
   * counts that do not change between them.
   */
  const status = useResource<IndexStatus>(
    serverUrl,
    mode === 'smart' ? '/assets/search/status' : null,
  );

  const clearance = useHeaderClearance(104);

  const bar: HeaderConfig = {
    title: 'Search',
    icon: 'search',
    below: (
      <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            paddingHorizontal: 13,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: focused ? colors.primary : colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Icon name="search" size={17} color={focused ? colors.primary : colors.faint} />
          <TextInput
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={
              mode === 'smart'
                ? 'What is in the photo?'
                : mode === 'people-and-pets'
                  ? "A person or pet's name"
                  : mode === 'places'
                    ? 'A town, album or folder'
                    : 'A file name'
            }
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            // Skips the debounce when someone has finished typing and said so.
            onSubmitEditing={() => setQuery(text.trim())}
            style={{ flex: 1, color: colors.text, fontSize: 16, paddingVertical: 11 }}
          />
          {text.length > 0 && (
            <Pressable
              onPress={() => setText('')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Clear"
            >
              <Icon name="close" size={16} color={colors.faint} />
            </Pressable>
          )}
        </View>

        <Segmented
          segments={[
            { id: 'smart', label: 'Content', icon: 'sparkle' },
            {
              id: 'people-and-pets',
              label: 'People & Pets',
              icon: 'people-and-pets',
              weight: 1.3,
            },
            { id: 'places', label: 'Places', icon: 'pin' },
            { id: 'files', label: 'Files', icon: 'photo' },
          ]}
          active={mode}
          onChange={(next) => {
            selection.clear();
            setMode(next);
          }}
        />
      </View>
    ),
  };

  const selection = useSelection();
  const items = data?.items ?? [];
  const folders = data?.folders ?? [];
  const albums = data?.albums ?? [];

  return (
    <View collapsable={false} style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={items}
        token={token}
        loading={loading}
        onRefresh={query ? reload : undefined}
        topInset={clearance}
        selected={selection.ids}
        onToggle={selection.toggle}
        onStartSelecting={selection.start}
        onChanged={reload}
        header={
          <View style={{ paddingTop: 14 }}>
            {error && (
              <Text
                style={{
                  color: colors.danger,
                  fontSize: 14,
                  lineHeight: 20,
                  paddingHorizontal: 16,
                  marginBottom: 14,
                }}
              >
                {error}
              </Text>
            )}

            {mode === 'people-and-pets' && matches.length > 0 && (
              <Section
                title={needle ? 'Matching' : 'Everyone'}
                trailing={`${matches.length}`}
              >
                <View
                  style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 16 }}
                >
                  {matches.map((subject) => (
                    <SubjectCard
                      key={subject.id}
                      serverUrl={serverUrl}
                      subject={subject}
                      token={subjects.token}
                      size={68}
                      onPress={() =>
                        router.push({
                          pathname: '/subject/[id]',
                          params: { id: subject.id, kind: subject.kind, title: subject.name || 'Unnamed' },
                        })
                      }
                    />
                  ))}
                </View>
              </Section>
            )}

            {mode === 'places' && placeMatches.length > 0 && (
              <Section title="Places" trailing={`${placeMatches.length}`}>
                <View style={{ paddingHorizontal: 16, gap: 8 }}>
                  {placeMatches.map((town) => (
                    <FolderCard
                      key={[town.city, town.country].join(',')}
                      folder={{ name: [town.city, town.country].filter(Boolean).join(', ') }}
                      detail={`${town.count.toLocaleString()} ${town.count === 1 ? 'photo' : 'photos'}`}
                      onPress={() =>
                        router.push({
                          pathname: '/place/[city]',
                          params: {
                            city: town.city ?? '',
                            title: [town.city, town.country].filter(Boolean).join(', '),
                          },
                        })
                      }
                    />
                  ))}
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
                      // The places endpoint returns names only, with no counts
                      // to put here. "0 photos" would be a lie about a folder
                      // that matched precisely because of what is in it.
                      detail="Folder"
                      onPress={() => router.push({ pathname: '/folder/[id]', params: { id: folder.id, title: folder.name } })}
                    />
                  ))}
                </View>
              </Section>
            )}

            {albums.length > 0 && (
              <Section title="Albums" trailing={`${albums.length}`}>
                <View
                  style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12 }}
                >
                  {albums.map((album) => (
                    <View key={album.id} style={{ width: '47.5%' }}>
                      <AlbumCard
                        serverUrl={serverUrl}
                        album={album}
                        token={token}
                        onPress={() => router.push({ pathname: '/album/[id]', params: { id: album.id, title: album.name } })}
                      />
                    </View>
                  ))}
                </View>
              </Section>
            )}

            {items.length > 0 && (folders.length > 0 || albums.length > 0) && (
              <Section title="Photos" trailing={items.length.toLocaleString()} />
            )}
          </View>
        }
        // A search that turns up albums or faces but no loose photos has found
        // something; only a search that found nothing at all is empty.
        showEmptyState={
          folders.length === 0 &&
          albums.length === 0 &&
          matches.length === 0 &&
          placeMatches.length === 0
        }
        emptyIcon={
          mode === 'smart'
            ? 'sparkle'
            : mode === 'people-and-pets'
              ? 'people-and-pets'
              : mode === 'places'
                ? 'folder'
                : 'photo'
        }
        emptyTitle={
          mode === 'people-and-pets'
            ? subjects.loading
              ? 'Loading…'
              : needle
                ? 'Nobody by that name'
                : 'Nobody found yet'
            : !query
              ? mode === 'smart'
                ? 'Search by what is in the photo'
                : mode === 'places'
                  ? 'Search your albums and folders'
                  : 'Search by file name'
              : loading
                ? 'Searching…'
                : 'Nothing matched'
        }
        emptyBody={
          mode === 'people-and-pets'
            ? needle
              ? `No person or pet is named anything like “${query}”. Unnamed groups can be named from the People & Pets tab.`
              : 'Once your photos have been scanned, the people and pets in them can be searched for by name here.'
            : !query
              ? blurb(mode)
              : mode === 'smart' && status.data
                ? indexBlurb(status.data)
                : `Nothing in your library matches “${query}”.`
        }
        // Something to press before anyone knows what content search can do.
        // A blank screen with a text field does not suggest "dog on a sofa".
        emptyExtra={
          !query && mode === 'smart' ? (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 8,
                marginTop: 20,
              }}
            >
              {SUGGESTIONS.map((phrase) => (
                <Pressable
                  key={phrase}
                  onPress={() => {
                    setText(phrase);
                    setQuery(phrase);
                  }}
                  style={({ pressed }) => ({
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.raised : 'transparent',
                  })}
                >
                  <Text style={{ color: colors.muted, fontSize: 13.5 }}>{phrase}</Text>
                </Pressable>
              ))}
            </View>
          ) : null
        }
      />

      <PhotoActions
        serverUrl={serverUrl}
        ids={selection.ids}
        allFavorite={
          selection.ids.length > 0 &&
          selection.ids.every((id) => items.find((a) => a.id === id)?.isFavorite)
        }
        onClear={selection.clear}
        onDone={() => {
          selection.clear();
          reload();
        }}
      />
      <Header {...bar} account={<Account />}>
        {bar.below}
      </Header>
      <SelectionDock />
    </View>
  );
}

const blurb = (mode: Mode) =>
  mode === 'smart'
    ? 'Your server compares the words against the pictures themselves, so they need not appear in any file name.'
    : mode === 'people-and-pets'
      ? 'Finds a person or pet by name, and opens every photo they appear in.'
      : mode === 'places'
        ? 'Finds albums and folders by name, and shows everything filed inside them.'
        : 'Matches part of a file name, such as IMG_0421 or .mov.';

/**
 * Content search that finds nothing usually means it has not looked yet.
 *
 * Describing photos is a background job that runs long after upload, so a fresh
 * library answers every phrase with silence. Saying "nothing matched" there is
 * misleading — nothing has been read.
 */
const indexBlurb = (status: IndexStatus) => {
  if (!status.available) {
    return 'This server has no machine-learning service running, so it cannot search by picture content yet.';
  }
  if (status.indexed < status.total) {
    const left = (status.total - status.indexed).toLocaleString();
    return `Only ${status.indexed.toLocaleString()} of ${status.total.toLocaleString()} photos have been described so far. ${left} still to go.`;
  }
  return 'Nothing in your library looks like that.';
};
