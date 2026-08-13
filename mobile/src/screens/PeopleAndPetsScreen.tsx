import { useState } from 'react';
import { FlatList, Text, useWindowDimensions, View } from 'react-native';
import { Empty } from '../components/AssetGrid';
import { Loading } from '../components/Loading';
import { SubjectCard } from '../components/Cards';
import { useHeaderClearance } from '../components/Header';
import { useHeaderSlot } from '../header';
import { Segmented } from '../components/Segmented';
import { useResource, type Subject } from '../lib/api';
import { useRouter } from 'expo-router';
import { colors, TAB_BAR_CLEARANCE } from '../theme';

interface Status {
  enabled: boolean;
  ready: boolean;
  petsReady?: boolean;
  pendingAssets: number;
}

type Kind = 'PERSON' | 'PET';

const COLUMNS = 4;
const GUTTER = 16;

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
  const { width } = useWindowDimensions();

  /**
   * Every group, however few photos it has.
   *
   * Without `minFaces` the server falls back to its configured minimum and
   * quietly drops the small unnamed groups — which is most of them on a fresh
   * library, with nothing on screen to say why. The web client passes 1 for the
   * same reason, and a group that cannot be seen cannot be named or merged into
   * the right person, which is exactly what a two-face group usually needs.
   */
  const subjectsPath = `/people-and-pets?kind=${kind}&minFaces=1&size=300`;
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

  const clearance = useHeaderClearance(54);

  // The bar itself belongs to the shell; this only says what goes in it.
  useHeaderSlot(
    'people-and-pets',
    {
      title: 'People & Pets',
      icon: 'people-and-pets',
      below: (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <Segmented
            segments={[
              { id: 'PERSON', label: 'People', icon: 'person' },
              { id: 'PET', label: 'Pets', icon: 'pet' },
            ]}
            active={kind}
            onChange={setKind}
          />
        </View>
      ),
    },
    [kind],
  );

  // Four across, with the gutters taken out before the split rather than after,
  // so the last column ends the same distance from the edge as the first begins.
  const avatar = Math.floor((width - GUTTER * 2 - GUTTER * (COLUMNS - 1)) / COLUMNS);

  // Do not leave People on screen below the Pets selector while the second
  // request is loading or failed. That made the tab look as if every person
  // were being classified as a pet.
  const subjects = loadedPath === subjectsPath ? data ?? [] : [];
  const noun = kind === 'PET' ? 'pets' : 'people';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={subjects}
        keyExtractor={(subject) => subject.id}
        numColumns={COLUMNS}
        columnWrapperStyle={{ gap: GUTTER, paddingHorizontal: GUTTER }}
        contentContainerStyle={{
          paddingTop: clearance + 8,
          paddingBottom: TAB_BAR_CLEARANCE,
          gap: 18,
        }}
        onRefresh={reload}
        refreshing={loading && subjects.length > 0}
        progressViewOffset={clearance}
        ListHeaderComponent={
          <Notice status={status.data} error={error ?? status.error} noun={noun} />
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
                params: { id: item.id, kind: item.kind, title: item.name || 'Unnamed' },
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
function Notice({
  status,
  error,
  noun,
}: {
  status: Status | null;
  error: string | null;
  noun: string;
}) {
  const message = error
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

  if (!message) return null;

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
