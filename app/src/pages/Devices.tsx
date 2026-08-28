import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Smartphone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AssetViewer } from '../components/AssetViewer';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { SelectionBar } from '../components/SelectionBar';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage, mediaUrl } from '../lib/api';
import { runBatchedOperation } from '../lib/operationProgress';
import { useSelection } from '../lib/useSelection';
import type { Asset, Device, Paginated } from '../types';
import { ConfirmDialog, EmptyState, IconButton, Loading, Tooltip } from '../ui';

export function DevicesPage() {
  const { deviceId } = useParams();
  return deviceId ? <DeviceLibrary deviceId={deviceId} /> : <DeviceList />;
}

/** Every mobile photo library backed up to this account. */
function DeviceList() {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<Device | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.get<Device[]>('/devices')).data,
  });
  const remove = useMutation({
    mutationFn: async (deviceId: string) => (await api.delete(`/devices/${deviceId}`)).data,
    onSuccess: () => {
      setRemoveError(null);
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (error) => setRemoveError(errorMessage(error)),
  });

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 flex items-baseline gap-3 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <h1 className="text-lg font-semibold tracking-tight">Devices</h1>
        <span className="text-xs tabular-nums text-content-muted">
          {isLoading ? '' : `${devices.length} device ${devices.length === 1 ? 'library' : 'libraries'}`}
        </span>
      </header>

      {removeError && <p className="px-5 pt-4 text-sm text-danger">{removeError}</p>}

      {isLoading ? (
        <Loading label="Loading devices…" />
      ) : devices.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title="No devices yet"
          description="A device library appears here after its first backup from the mobile app."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4 p-5">
          {devices.map((device) => (
            <article
              key={device.id}
              className="group relative overflow-hidden rounded-panel border border-border-subtle bg-surface-raised transition hover:border-primary"
            >
              <Link to={`/devices/${device.id}`} className="block">
                <span className="relative block aspect-[4/3] overflow-hidden bg-surface-sunken">
                  {device.coverAssetId ? (
                    <img
                      src={mediaUrl(device.coverAssetId, 'thumbnail')}
                      alt=""
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <span className="grid h-full place-items-center text-content-muted">
                      <Smartphone size={40} strokeWidth={1.4} />
                    </span>
                  )}
                  <span className="absolute bottom-2 left-2 grid h-9 w-9 place-items-center rounded-full bg-surface-overlay/90 text-secondary shadow-popover backdrop-blur">
                    <Smartphone size={18} />
                  </span>
                </span>
                <span className="block px-3 py-2.5 pr-12">
                  <Tooltip label={device.libraryName} onlyWhenOverflow>
                    <span className="block truncate text-sm font-medium">{device.libraryName}</span>
                  </Tooltip>
                  <span className="mt-0.5 block text-xs text-content-muted">
                    {device.assetCount.toLocaleString()} {device.assetCount === 1 ? 'item' : 'items'}
                  </span>
                </span>
              </Link>
              <IconButton
                label={`Remove ${device.libraryName}`}
                size="sm"
                className="absolute bottom-2 right-2"
                onClick={() => {
                  setRemoveError(null);
                  setRemoving(device);
                }}
              >
                <Trash2 size={15} />
              </IconButton>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={`Remove “${removing?.libraryName ?? 'device library'}”?`}
        description="Every photo and video in this device library will move to Trash for 30 days, and the device will be removed. It can appear again if it backs up later."
        confirmLabel={remove.isPending ? 'Removing…' : 'Remove device'}
        destructive
        onConfirm={() => removing && remove.mutate(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

/** One phone or tablet library, without duplicating its files in storage. */
function DeviceLibrary({ deviceId }: { deviceId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<Asset | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const { selected, toggle, selectRange, setAnchor, clear } = useSelection<Asset>();
  const { data: device, isLoading: deviceLoading } = useQuery({
    queryKey: ['devices', deviceId],
    queryFn: async () => (await api.get<Device>(`/devices/${deviceId}`)).data,
  });
  const { data: page, isLoading: assetsLoading } = useQuery({
    queryKey: ['devices', deviceId, 'assets'],
    queryFn: async () =>
      (await api.get<Paginated<Asset>>('/assets', { params: { deviceId, size: 1000 } })).data,
  });
  const assets = page?.items ?? [];
  const afterAssetChange = () => {
    clear();
    void queryClient.invalidateQueries({ queryKey: ['devices', deviceId] });
  };
  const actions = useLibraryActions({
    onShowDetails: setViewing,
    selectedIds: [...selected],
    onAfterChange: clear,
  });
  const favorite = useMutation({
    mutationFn: async (ids: string[]) => api.put('/assets/bulk', { ids, isFavorite: true }),
    onSuccess: afterAssetChange,
  });
  const trash = useMutation({
    mutationFn: async (ids: string[]) =>
      runBatchedOperation(
        ids.length === 1 ? 'Moving photo to Trash' : `Moving ${ids.length} photos to Trash`,
        ids,
        (batch) => api.delete('/assets', { data: { ids: batch } }),
      ),
    onSuccess: afterAssetChange,
  });
  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/devices/${deviceId}`)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      navigate('/devices');
    },
    onError: (error) => setRemoveError(errorMessage(error)),
  });

  if (deviceLoading) return <Loading label="Loading device library…" />;
  if (!device) return null;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <nav className="mb-1 flex items-center gap-1 text-xs text-content-muted">
          <Link to="/devices" className="flex items-center gap-1 transition hover:text-content">
            <ArrowLeft size={12} />
            Devices
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <Smartphone size={20} className="text-secondary" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{device.libraryName}</h1>
            <p className="text-xs text-content-muted">
              {device.assetCount.toLocaleString()} {device.assetCount === 1 ? 'item' : 'items'}
            </p>
          </div>
          <IconButton
            label="Remove device"
            className="ml-auto"
            onClick={() => {
              setRemoveError(null);
              setConfirmRemove(true);
            }}
          >
            <Trash2 size={17} />
          </IconButton>
        </div>
      </header>

      {removeError && <p className="px-5 pt-4 text-sm text-danger">{removeError}</p>}

      {!assetsLoading && assets.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title="This device library is empty"
          description="Photos and videos backed up from this device appear here."
        />
      ) : (
        <div className="px-2 pb-24 pt-2">
          <JustifiedGrid
            assets={assets}
            selected={selected}
            onOpen={setViewing}
            onToggleSelect={toggle}
            onSelectRange={(asset) => selectRange(asset, assets)}
            onAnchor={setAnchor}
            onContextMenu={actions.onAssetContextMenu}
          />
        </div>
      )}

      {actions.overlays}

      <SelectionBar
        count={selected.size}
        onClear={clear}
        onFavorite={() => favorite.mutate([...selected])}
        onMove={() => {
          const first = assets.find((asset) => selected.has(asset.id));
          if (first) actions.moveAssets(first, [...selected]);
        }}
        onDownload={() => {
          window.location.href = `/api/assets/download/archive?ids=${[...selected].join(',')}`;
        }}
        onTrash={() => trash.mutate([...selected])}
      />

      {viewing && (
        <AssetViewer
          asset={viewing}
          assets={assets}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove “${device.libraryName}”?`}
        description="Every photo and video in this device library will move to Trash for 30 days, and the device will be removed. It can appear again if it backs up later."
        confirmLabel={remove.isPending ? 'Removing…' : 'Remove device'}
        destructive
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  );
}
