import { useCallback, useRef, useState } from 'react';
import { FlatList, Platform, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollViewMarker } from 'react-native-screens/experimental';
import { Account } from '../components/Account';
import { Empty } from '../components/AssetGrid';
import { Loading } from '../components/Loading';
import { SubjectCard } from '../components/Cards';
import { Header, useHeaderClearance, type HeaderConfig } from '../components/Header';
import { BrowseTabs as GlassTabs } from '../components/BrowseTabs';
import { BROWSE_TAB_HEIGHT, BROWSE_TAB_GAP, BROWSE_TAB_INSET, BROWSE_TAB_LEADING_OFFSET, browseTabMaxWidth } from '../components/browseTabGeometry';
import { useResource, type Subject } from '../lib/api';
import { useFocusEffect, useRouter } from 'expo-router';
import { colors, TAB_BAR_CLEARANCE } from '../theme';

interface Status {
  enabled: boolean;
  ready: boolean;
  petsReady?: boolean;
  pendingAssets: number;
}

type Kind = 'PERSON' | 'PET';

const GUTTER = 16;
const MIN_AVATAR = 96;

/**
 * Everyone the server has found faces for, and every pet beside them.
 *
 * People and pets are separated rather than mixed: the two are recognised by
 * different models with different confidence, and a run of unnamed dogs in
 * among the family reads as the grouping having failed.
 */
export function PeopleAndPetsScreen({ serverUrl }: { serverUrl: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('PERSON');
  const [tabHeight, setTabHeight] = useState(BROWSE_TAB_HEIGHT);
  const tabRowHeight = tabHeight + BROWSE_TAB_GAP * 2;
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const contentWidth = Math.max(0, width - insets.left - insets.right);
  const columns = Math.max(2, Math.min(8, Math.floor((contentWidth - GUTTER) / (MIN_AVATAR + GUTTER))));
  const [refreshing, setRefreshing] = useState(false);
  const refreshGeneration = useRef(0);
  useFocusEffect(useCallback(() => () => {
    refreshGeneration.current++;
    setRefreshing(false);
  }, []));

  /**
   * Every group, however few photos it has.
   *
   * Without `minFaces` the server falls back to its configured minimum and
   * quietly drops the small unnamed groups — which is most of them on a fresh
   * library, with nothing on screen to say why. The web client passes 1 for the
   * same reason, and a group that cannot be seen cannot be named or merged into
   * the right person, which is exactly what a two-face group usually needs.
   */
  const subjectsPath = `/people-and-pets?kind=${kind}&minFaces=1`;
  const { data, loadedPath, token, error, loading, reload } = useResource<Subject[]>(
    serverUrl,
    subjectsPath,
    4000,
  );
  /*
   * Polled only while there is something to watch.
   *
   * The count only moves while a scan is running, and a scan can be started
   * from anywhere — the web client, another phone — so this screen has to ask
   * rather than wait to be told. Once nothing is outstanding the timer stops
   * and the screen goes quiet again.
   */
  const status = useResource<Status>(serverUrl, '/people-and-pets/status', 4000);
  const refresh = useCallback(async () => {
    const mine = ++refreshGeneration.current;
    setRefreshing(true);
    try {
      await Promise.all([reload(), status.reload()]);
    } finally {
      if (mine === refreshGeneration.current) setRefreshing(false);
    }
  }, [reload, status.reload]);

  const clearance = useHeaderClearance(tabRowHeight);

  const bar: HeaderConfig = {
    title: 'People & Pets',
    icon: 'people-and-pets',
    below: (
      <View style={{ width: '100%', maxWidth: Platform.OS === 'ios' ? browseTabMaxWidth(230, Platform.isPad) : undefined,
        alignSelf: 'flex-start', marginLeft: Platform.OS === 'ios' ? BROWSE_TAB_LEADING_OFFSET : 0,
        height: tabRowHeight, paddingHorizontal: Platform.OS === 'ios' ? BROWSE_TAB_INSET : 16,
        paddingVertical: BROWSE_TAB_GAP }}>
        <GlassTabs
          height={tabHeight}
          onHeightChange={setTabHeight}
          segments={[
            { id: 'PERSON', label: 'People', icon: 'person' },
            { id: 'PET', label: 'Pets', icon: 'pet' },
          ]}
          active={kind}
          onChange={setKind}
        />
      </View>
    ),
  };

  // Keep portraits readable as the window folds, excluding the native side rail.
  const avatar = Math.max(1, Math.floor((contentWidth - GUTTER * 2 - GUTTER * (columns - 1)) / columns));

  // Do not leave People on screen below the Pets selector while the second
  // request is loading or failed. That made the tab look as if every person
  // were being classified as a pet.
  const subjects = loadedPath === subjectsPath ? data ?? [] : [];
  const noun = kind === 'PET' ? 'pets' : 'people';
  const noticeError = error ?? status.error;
  const notice = recognitionNotice(status.data, noticeError, noun);

  return (
    <View collapsable={false} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollViewMarker style={{ flex: 1 }}>
        <FlatList
          key={columns}
          data={subjects}
          keyExtractor={(subject) => subject.id}
          numColumns={columns}
          columnWrapperStyle={{ gap: GUTTER, paddingHorizontal: GUTTER, marginBottom: 18 }}
          contentContainerStyle={{
            paddingTop: clearance,
            paddingBottom: TAB_BAR_CLEARANCE,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          }}
          onRefresh={refresh}
          refreshing={refreshing}
          progressViewOffset={clearance}
          ListHeaderComponent={
            notice ? <Notice message={notice} error={noticeError} /> : null
          }
          renderItem={({ item }) => (
            <SubjectCard
              serverUrl={serverUrl}
              subject={item}
              token={token}
              size={avatar}
              onPress={() =>
                router.push({
                  pathname: '/subject/[id]',
                  params: {
                    id: item.id,
                    kind: item.kind,
                    species: item.species ?? '',
                    title: item.name || 'Unnamed',
                  },
                })
              }
            />
          )}
          ListEmptyComponent={
            loading ? (
              <Loading label={`Finding ${noun}…`} />
            ) : (
              <Empty
                icon={kind === 'PET' ? 'pet' : 'people-and-pets'}
                title={`No ${noun} yet`}
                body={
                  status.data && !status.data.enabled
                    ? 'This server has People & Pets recognition switched off, so nothing is being grouped.'
                    : `Once your photos have been scanned, the ${noun} in them are grouped here.`
                }
              />
            )
          }
        />
      </ScrollViewMarker>
      <Header {...bar} account={<Account />}>
        {bar.below}
      </Header>
    </View>
  );
}

/**
 * Why the grid might be emptier than expected.
 *
 * Scanning happens on the server long after an upload finishes, so a library
 * that has just been backed up shows almost nobody. Without saying so, the
 * feature simply looks broken.
 */
function recognitionNotice(status: Status | null, error: string | null, noun: string) {
  return error
    ? error
    : !status
      ? null
      : !status.enabled
        ? 'People & Pets recognition is switched off on this server.'
        : noun === 'pets' && status.petsReady === false
          ? 'Pet recognition is not available on this server yet.'
        : !status.ready
          ? 'The recognition service is still starting up. Pull to refresh in a minute.'
          : status.pendingAssets > 0
            ? `${status.pendingAssets.toLocaleString()} photos are still waiting to be scanned, so more ${noun} may appear.`
            : null;

}

function Notice({ message, error }: { message: string; error: string | null }) {
  return (
    <View
      style={{
        marginHorizontal: GUTTER,
        marginBottom: 18,
        padding: 13,
        borderRadius: 14,
        backgroundColor: colors.surface,
      }}
    >
      <Text style={{ color: error ? colors.danger : colors.muted, fontSize: 13.5, lineHeight: 20 }}>
        {message}
      </Text>
    </View>
  );
}
