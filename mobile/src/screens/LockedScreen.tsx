import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { AssetGrid } from '../components/AssetGrid';
import { Header, useHeaderClearance } from '../components/Header';
import { VaultSheet, type VaultStatus } from '../components/sheets';
import { Button } from '../components/ui';
import { usePagedResource, useResource, type Asset } from '../lib/api';
import { colors } from '../theme';

export function LockedScreen({
  serverUrl,
  onBack,
}: {
  serverUrl: string;
  onBack: () => void;
}) {
  const [unlocking, setUnlocking] = useState(false);
  const status = useResource<VaultStatus>(serverUrl, '/auth/vault');
  const unlocked = status.data?.isUnlocked === true;
  const media = usePagedResource<Asset>(serverUrl, unlocked ? '/assets/locked' : null);
  const clearance = useHeaderClearance();

  const reload = useCallback(() => {
    void status.reload();
    void media.reload();
  }, [status.reload, media.reload]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={media.items}
        token={media.token ?? status.token}
        loading={status.loading || (unlocked && media.loading)}
        onRefresh={reload}
        topInset={clearance}
        onChanged={reload}
        hasMore={media.hasMore}
        loadingMore={media.loadingMore}
        onLoadMore={media.loadMore}
        emptyIcon="lock"
        emptyTitle={unlocked ? 'Nothing locked yet' : 'Locked is protected'}
        emptyBody={
          unlocked
            ? 'Photos and videos you move to Locked appear here.'
            : 'Enter your private password to see locked photos and videos on this device.'
        }
        emptyExtra={
          unlocked ? null : (
            <Button
              label={status.data?.isConfigured === false ? 'Set private password' : 'Unlock'}
              icon="unlock"
              onPress={() => setUnlocking(true)}
            />
          )
        }
      />

      <Header title="Locked" icon="lock" onBack={onBack} />
      <VaultSheet
        open={unlocking}
        serverUrl={serverUrl}
        onClose={() => setUnlocking(false)}
        onUnlocked={() => void status.reload()}
      />
    </View>
  );
}
