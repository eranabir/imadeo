import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AssetViewer } from '../components/AssetViewer';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { api, mediaUrl } from '../lib/api';
import type { Asset, Device, Paginated } from '../types';
import { EmptyState, Loading, Tooltip } from '../ui';

export function DevicesPage() {
  const { deviceId } = useParams();
  return deviceId ? <DeviceLibrary deviceId={deviceId} /> : <DeviceList />;
}

/** Every mobile photo library backed up to this account. */
function DeviceList() {
  const { data: devices = [], isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.get<Device[]>('/devices')).data,
  });

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 flex items-baseline gap-3 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <h1 className="text-lg font-semibold tracking-tight">Devices</h1>
        <span className="text-xs tabular-nums text-content-muted">
          {isLoading ? '' : `${devices.length} device ${devices.length === 1 ? 'library' : 'libraries'}`}
        </span>
      </header>

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
            <Link
              key={device.id}
              to={`/devices/${device.id}`}
              className="group overflow-hidden rounded-panel border border-border-subtle bg-surface-raised transition hover:border-primary"
            >
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
              <span className="block px-3 py-2.5">
                <Tooltip label={device.libraryName} onlyWhenOverflow>
                  <span className="block truncate text-sm font-medium">{device.libraryName}</span>
                </Tooltip>
                <span className="mt-0.5 block text-xs text-content-muted">
                  {device.assetCount.toLocaleString()} {device.assetCount === 1 ? 'item' : 'items'}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** One phone or tablet library, without duplicating its files in storage. */
function DeviceLibrary({ deviceId }: { deviceId: string }) {
  const [viewing, setViewing] = useState<Asset | null>(null);
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
        </div>
      </header>

      {!assetsLoading && assets.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title="This device library is empty"
          description="Photos and videos backed up from this device appear here."
        />
      ) : (
        <div className="px-2 pb-24 pt-2">
          <JustifiedGrid assets={assets} onOpen={setViewing} />
        </div>
      )}

      {viewing && (
        <AssetViewer
          asset={viewing}
          assets={assets}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}
    </div>
  );
}
