import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AssetThumbnail } from '../components/AssetThumbnail';
import { Icon } from '../components/Icon';
import { MediaSortControl, MEDIA_SORT_HEIGHT, type MediaSort } from '../components/MediaSort';
import { Touchable } from '../components/ui';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { FolderCard, Section } from '../components/Cards';
import { Header, HeaderAction, useHeaderClearance } from '../components/Header';
import { PhotoActions } from '../components/PhotoActions';
import { SelectionDock } from '../components/SelectionDock';
import { ConfirmSheet } from '../components/sheets';
import { actions } from '../lib/actions';
import { useResource, type Device } from '../lib/api';
import { cancelBackup, currentDeviceId } from '../lib/backup';
import { isEnabled, setEnabled } from '../lib/autobackup';
import { useMediaViewMode } from '../lib/viewMode';
import { colors, radius, TAB_BAR_CLEARANCE } from '../theme';
import { sortDevices } from '../lib/deviceSort';
import { useDeviceAssets } from '../lib/useDeviceAssets';

interface ListProps {
  serverUrl: string;
  onBack: () => void;
}

/** Mobile libraries that have backed up to this account. */
export function DevicesScreen({ serverUrl, onBack }: ListProps) {
  const router = useRouter();
  const { data, token, error, loading, reload } = useResource<Device[]>(serverUrl, '/devices');
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [viewMode, setViewMode] = useMediaViewMode();
  const [sort, setSort] = useState<MediaSort>('date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [refreshing, setRefreshing] = useState(false);
  const refreshGeneration = useRef(0);
  useFocusEffect(useCallback(() => () => { refreshGeneration.current++; setRefreshing(false); }, []));
  const refresh = async () => {
    const mine = ++refreshGeneration.current;
    setRefreshing(true);
    try { await reload(); } finally { if (mine === refreshGeneration.current) setRefreshing(false); }
  };
  const clearance = useHeaderClearance(MEDIA_SORT_HEIGHT);
  const devices = sortDevices(data ?? [], sort, order);
  const availableWidth = width - insets.left - insets.right - 32;
  const columns = Math.max(2, Math.min(5, Math.floor(availableWidth / 170)));
  const cardWidth = Math.floor((availableWidth - 12 * (columns - 1)) / columns);
  const openDevice = (device: Device) => router.push({ pathname: '/device/[id]',
    params: { id: device.id, title: device.libraryName } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: clearance, paddingBottom: TAB_BAR_CLEARANCE,
          paddingLeft: insets.left, paddingRight: insets.right }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={clearance} tintColor={colors.primary} />}
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
            <View style={{ paddingHorizontal: 16, gap: viewMode === 'grid' ? 12 : 8,
              flexDirection: viewMode === 'grid' ? 'row' : 'column',
              flexWrap: viewMode === 'grid' ? 'wrap' : 'nowrap' }}>
              {devices.map((device) => (
                viewMode === 'grid' ? <Touchable key={device.id} radius={radius.md}
                  label={device.libraryName} onPress={() => openDevice(device)}
                  style={{ width: cardWidth, backgroundColor: colors.surface }}>
                  <View style={{ height: cardWidth, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
                    {device.coverAssetId ? <AssetThumbnail serverUrl={serverUrl} assetId={device.coverAssetId}
                      token={token} style={{ width: '100%', height: '100%' }} contentFit="cover" /> :
                      <Icon name="phone" size={36} color={colors.primary} />}
                  </View>
                  <View style={{ padding: 12 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{device.libraryName}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 3 }}>{device.assetCount.toLocaleString()} items</Text>
                  </View>
                </Touchable> : <View key={device.id} style={{ width: '100%' }}><FolderCard
                  folder={{ name: device.libraryName, cardIcon: 'phone', assetCount: device.assetCount }}
                  detail={`${device.assetCount.toLocaleString()} ${device.assetCount === 1 ? 'item' : 'items'}`}
                  onPress={() => openDevice(device)}
                /></View>
              ))}
            </View>
          </Section>
        )}
      </ScrollView>
      <Header
        title="Devices"
        subtitle={`${devices.length} device ${devices.length === 1 ? 'library' : 'libraries'}`}
        icon="phone"
        onBack={onBack}
        action={<HeaderAction label={viewMode === 'grid' ? 'Show as list' : 'Show as grid'}
          icon={viewMode === 'grid' ? 'list' : 'grid'} compact
          onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')} />}
      >
        <MediaSortControl sort={sort} order={order} onSort={value => { setSort(value); setOrder(value === 'date' ? 'desc' : 'asc'); }} onOrder={setOrder} />
      </Header>
    </View>
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
  const router = useRouter();
  const device = useResource<Device>(serverUrl, `/devices/${deviceId}`);
  const [sort, setSort] = useState<MediaSort>('date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const assets = useDeviceAssets(serverUrl, deviceId, sort, order);
  const clearance = useHeaderClearance(MEDIA_SORT_HEIGHT);
  const selection = useSelection();
  const [viewMode, setViewMode] = useMediaViewMode();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const removeDevice = async () => {
    setRemoveError(null);
    let restoreAutomaticBackup = false;
    try {
      const removesThisPhone = device.data?.clientId === await currentDeviceId();
      if (removesThisPhone) {
        restoreAutomaticBackup = await isEnabled();
        if (restoreAutomaticBackup) await setEnabled(false);
        await cancelBackup();
      }
      await actions.removeDevice(serverUrl, deviceId);
      setConfirmRemove(false);
      router.back();
    } catch (cause) {
      if (restoreAutomaticBackup) await setEnabled(true);
      setRemoveError(cause instanceof Error ? cause.message : 'Could not remove this device.');
      return false;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={assets.items}
        token={assets.token}
        loading={assets.loading || device.loading}
        onRefresh={() => Promise.all([device.reload(), assets.reload()])}
        topInset={clearance}
        selected={selection.ids}
        onToggle={selection.toggle}
        onStartSelecting={selection.start}
        onChanged={assets.reload}
        hasMore={assets.hasMore}
        loadingMore={assets.loadingMore}
        onLoadMore={assets.loadMore}
        viewMode={viewMode}
        header={
          removeError || assets.error || device.error ? (
            <Text style={{ color: colors.danger, paddingHorizontal: 16, paddingVertical: 12 }}>
              {removeError ?? assets.error ?? device.error}
            </Text>
          ) : null
        }
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
      <Header
        title={selection.active ? `${selection.ids.length} selected` : device.data?.libraryName ?? title}
        subtitle={
          device.data
            ? `${device.data.assetCount.toLocaleString()} ${device.data.assetCount === 1 ? 'item' : 'items'}`
            : 'Loading…'
        }
        icon="phone"
        onBack={onBack}
        action={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>

            <HeaderAction
              label={viewMode === 'grid' ? 'Show as list' : 'Show as grid'}
              icon={viewMode === 'grid' ? 'list' : 'grid'}
              compact
              onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            />
            <HeaderAction
              label="Remove device"
              icon="trash"
              compact
              onPress={() => setConfirmRemove(true)}
            />
          </View>
        }
      >
        <MediaSortControl sort={sort} order={order} onSort={value => {
          selection.clear(); setSort(value); setOrder(value === 'date' ? 'desc' : 'asc');
        }} onOrder={value => { selection.clear(); setOrder(value); }} />
      </Header>
      <SelectionDock />

      <ConfirmSheet
        open={confirmRemove}
        title={`Remove “${device.data?.libraryName ?? title}”?`}
        description="Every photo and video in this device library will move to Trash for 30 days, and the device will be removed. Automatic backup is turned off when you remove this phone, so it cannot immediately recreate the library."
        confirmLabel="Remove device"
        onClose={() => setConfirmRemove(false)}
        onConfirm={removeDevice}
      />
    </View>
  );
}
