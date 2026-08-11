import { useState } from 'react';
import { Text, View } from 'react-native';
import { AssetGrid, useSelection } from '../components/AssetGrid';
import { HeaderAction, useHeaderClearance } from '../components/Header';
import { useHeaderSlot } from '../header';
import { PhotoActions } from '../components/PhotoActions';
import { ShareSheet } from '../components/sheets';
import { actions } from '../lib/actions';
import { useResource, type Asset } from '../lib/api';
import { colors } from '../theme';

interface AlbumDetail {
  id: string;
  name: string;
  description: string | null;
  assetCount: number;
  shared?: boolean;
  albumUsers?: { user: { id: string; name: string | null; email: string } }[];
  assets: Asset[];
  pagination: { page: number; size: number; total: number };
}

interface Props {
  /** Where this screen publishes its bar. */
  slot: string;
  serverUrl: string;
  albumId: string;
  title: string;
  onBack: () => void;
}

/** Everything inside one album. */
export function AlbumScreen({ serverUrl, albumId, title, slot, onBack }: Props) {
  const { data, token, error, loading, reload } = useResource<AlbumDetail>(
    serverUrl,
    `/albums/${albumId}?size=500&sortBy=date&order=desc`,
  );
  const clearance = useHeaderClearance();
  const selection = useSelection();
  const [sharing, setSharing] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const shared = data?.albumUsers?.length ?? 0;
  const subtitle = [
    data ? `${data.assetCount.toLocaleString()} ${data.assetCount === 1 ? 'photo' : 'photos'}` : '…',
    shared > 0 ? `shared with ${shared}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Published rather than drawn: the shell owns the one bar, and a screen that
  // brought its own would slide it in over the top of the one already there.
  useHeaderSlot(
    slot,
    {
      title: data?.name ?? title,
      subtitle,
      icon: 'album',
      onBack,
      action: <HeaderAction label="Share album" icon="shared" compact onPress={() => setSharing(true)} />,
    },
    [data?.name, title, subtitle, onBack],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AssetGrid
        serverUrl={serverUrl}
        assets={data?.assets ?? []}
        token={token}
        loading={loading}
        onRefresh={reload}
        topInset={clearance}
        header={
          error || shareError || data?.description ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
              {error && <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>}
              {shareError && <Text style={{ color: colors.danger, fontSize: 14 }}>{shareError}</Text>}
              {data?.description && (
                <Text style={{ color: colors.muted, fontSize: 14.5, lineHeight: 21 }}>
                  {data.description}
                </Text>
              )}
            </View>
          ) : null
        }
        selected={selection.ids}
        onToggle={selection.toggle}
        onStartSelecting={selection.start}
        onChanged={reload}
        emptyIcon="album"
        emptyTitle={loading ? 'Loading…' : 'This album is empty'}
        emptyBody="Photos added to it, here or on the web, show up in this grid."
      />

      <PhotoActions
        serverUrl={serverUrl}
        ids={selection.ids}
        allFavorite={
          selection.ids.length > 0 &&
          selection.ids.every((id) => data?.assets.find((a) => a.id === id)?.isFavorite)
        }
        onClear={selection.clear}
        onDone={() => {
          selection.clear();
          reload();
        }}
      />

      <ShareSheet
        open={sharing}
        serverUrl={serverUrl}
        assetIds={[]}
        title="Share album"
        description="Choose who can view this album. They can view the photos but cannot change your library."
        busy={shareBusy}
        onClose={() => setSharing(false)}
        onShare={async (userIds) => {
          setShareBusy(true);
          setShareError(null);
          try {
            await actions.shareAlbum(serverUrl, albumId, userIds);
            setSharing(false);
            reload();
          } catch (cause) {
            setShareError(cause instanceof Error ? cause.message : 'Could not share this album.');
          } finally {
            setShareBusy(false);
          }
        }}
      />
    </View>
  );
}
