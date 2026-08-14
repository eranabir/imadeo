import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { FolderCard, Section } from '../components/Cards';
import { useHeaderClearance } from '../components/Header';
import { PhotoActions } from '../components/PhotoActions';
import { useHeaderSlot } from '../header';
import { usePagedResource, useResource, type Asset, type Device } from '../lib/api';
import { colors } from '../theme';

interface ListProps {
  serverUrl: string;
  onBack: () => void;
}

/** Mobile libraries that have backed up to this account. */
export function DevicesScreen({ serverUrl, onBack }: ListProps) {
  const router = useRouter();
  const { data, error, loading, reload } = useResource<Device[]>(serverUrl, '/devices');
  const clearance = useHeaderClearance();
  const devices = data ?? [];

  useHeaderSlot(
    'devices',
    {
      title: 'Devices',
      subtitle: `${devices.length} device ${devices.length === 1 ? 'library' : 'libraries'}`,
      icon: 'phone',
      onBack,
    },
    [devices.length, onBack],
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: clearance + 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.primary} />}
    >
      {error && <Text style={{ color: colors.danger, paddingHorizontal: 16 }}>{error}</Text>}
      {!loading && devices.length === 0 ? (
        <View style={{ paddingHorizontal: 24, paddingTop: 56, alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>No devices yet</Text>
          <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 }}>
            A device library appears here after its first mobile backup.
          </Text>
        </View>
      ) : (
        <Section title="Libraries" trailing={`${devices.length}`}>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {devices.map((device) => (
              <FolderCard
                key={device.id}
                folder={{ name: device.libraryName, cardIcon: 'phone', assetCount: device.assetCount }}
                detail={`${device.assetCount.toLocaleString()} ${device.assetCount === 1 ? 'item' : 'items'}`}
                onPress={() =>
                  router.push({
                    pathname: '/device/[id]',
                    params: { id: device.id, title: device.libraryName },
                  })
                }
              />
            ))}
          </View>
        </Section>
      )}
    </ScrollView>
  );
}

interface DetailProps {
  serverUrl: string;
  deviceId: string;
  title: string;
  onBack: () => void;
}

/** The photos and videos known to one phone or tablet library. */
export function DeviceLibraryScreen({ serverUrl, deviceId, title, onBack }: DetailProps) {
  const device = useResource<Device>(serverUrl, `/devices/${deviceId}`);
  const assets = usePagedResource<Asset>(serverUrl, `/assets?deviceId=${encodeURIComponent(deviceId)}`);
  const clearance = useHeaderClearance();
  const selection = useSelection();

  useHeaderSlot(
    `device:${deviceId}`,
    {
      title: device.data?.libraryName ?? title,
      subtitle: device.data
        ? `${device.data.assetCount.toLocaleString()} ${device.data.assetCount === 1 ? 'item' : 'items'}`
        : 'Loading…',
      icon: 'phone',
      onBack,
    },
    [deviceId, device.data?.libraryName, device.data?.assetCount, title, onBack],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={assets.items}
        token={assets.token}
        loading={assets.loading || device.loading}
        onRefresh={() => {
          device.reload();
          assets.reload();
        }}
        topInset={clearance}
        selected={selection.ids}
        onToggle={selection.toggle}
        onStartSelecting={selection.start}
        onChanged={assets.reload}
        hasMore={assets.hasMore}
        loadingMore={assets.loadingMore}
        onLoadMore={assets.loadMore}
        emptyIcon="phone"
        emptyTitle={assets.loading ? 'Loading…' : 'This device library is empty'}
        emptyBody="Photos and videos backed up from this device appear here."
      />
      <PhotoActions
        serverUrl={serverUrl}
        ids={selection.ids}
        allFavorite={
          selection.ids.length > 0 &&
          selection.ids.every((id) => assets.items.find((asset) => asset.id === id)?.isFavorite)
        }
        onClear={selection.clear}
        onDone={() => {
          selection.clear();
          assets.reload();
          device.reload();
        }}
      />
    </View>
  );
}
