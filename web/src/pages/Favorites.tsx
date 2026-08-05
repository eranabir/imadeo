import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { useState } from 'react';
import { AssetViewer } from '../components/AssetViewer';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { api } from '../lib/api';
import { formatDate, groupByDay } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Asset, Paginated } from '../types';

export function Favorites() {
  const { user } = useAuth();
  const [viewing, setViewing] = useState<Asset | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['assets', 'favorites'],
    queryFn: async () =>
      (await api.get<Paginated<Asset>>('/assets', { params: { isFavorite: true, size: 500 } })).data,
  });

  const assets = data?.items ?? [];

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 flex items-baseline gap-3 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <h1 className="text-lg font-semibold tracking-tight">Favorites</h1>
        <span className="text-xs tabular-nums text-content-muted">
          {isLoading ? '' : `${assets.length} items`}
        </span>
      </header>

      {!isLoading && assets.length === 0 ? (
        <div className="grid place-items-center py-32 text-center">
          <Heart size={44} className="mb-4 text-rose-500/50" strokeWidth={1.4} />
          <p className="font-medium">Nothing favorited yet</p>
          <p className="mt-1 max-w-xs text-sm text-content-muted">
            Open a photo and press <kbd className="rounded bg-surface-sunken px-1.5 py-0.5">f</kbd>{' '}
            to keep it here.
          </p>
        </div>
      ) : (
        <div className="px-2 pb-24 pt-2">
          {groupByDay(assets).map(({ day, items }) => (
            <section key={day} className="mb-4">
              <h2 className="sticky top-[53px] z-10 mb-1.5 w-fit rounded-full bg-surface/85 px-3 py-1 text-[13px] font-medium backdrop-blur">
                {formatDate(day, user?.preferences.locale)}
              </h2>
              <JustifiedGrid
                assets={items}
                targetRowHeight={user?.preferences.tileSize ?? 220}
                onOpen={setViewing}
              />
            </section>
          ))}
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
