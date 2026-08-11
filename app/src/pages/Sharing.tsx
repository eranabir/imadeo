import { useQuery } from '@tanstack/react-query';
import { Folder, Share2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlbumCover } from '../components/AlbumCover';
import { AssetViewer } from '../components/AssetViewer';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import type { Album, Asset, FolderNode, Paginated } from '../types';
import { EmptyState, Loading } from '../ui';

const flatten = (nodes: FolderNode[]): FolderNode[] =>
  nodes.flatMap((folder) => [folder, ...flatten(folder.children)]);

/** A single place to find everything other accounts have explicitly shared. */
export function Sharing() {
  const { user } = useAuth();
  const [viewing, setViewing] = useState<Asset | null>(null);
  const assetsQuery = useQuery({
    queryKey: ['assets', 'sharing'],
    queryFn: async () => (await api.get<Paginated<Asset>>('/assets', { params: { size: 500 } })).data,
  });
  const albumsQuery = useQuery({
    queryKey: ['albums', 'sharing'],
    queryFn: async () => (await api.get<Album[]>('/albums', { params: { shared: true } })).data,
  });
  const foldersQuery = useQuery({
    queryKey: ['folders', 'sharing'],
    queryFn: async () => (await api.get<FolderNode[]>('/folders/tree')).data,
  });

  if (assetsQuery.isLoading || albumsQuery.isLoading || foldersQuery.isLoading) {
    return <Loading label="Loading shared items…" />;
  }

  const assets = (assetsQuery.data?.items ?? []).filter((asset) => asset.ownerId !== user?.id);
  const albums = (albumsQuery.data ?? []).filter((album) => album.owner?.id !== user?.id);
  const folders = flatten(foldersQuery.data ?? []).filter((folder) => folder.shared);
  const empty = !assets.length && !albums.length && !folders.length;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Share2 size={18} className="text-secondary" />
          <h1 className="text-lg font-semibold tracking-tight">Sharing</h1>
        </div>
        <p className="mt-0.5 text-sm text-content-muted">Photos, albums and folders other accounts shared with you.</p>
      </header>

      {empty ? (
        <EmptyState
          icon={Share2}
          title="Nothing shared with you yet"
          description="When another account shares a photo, album, or folder, it appears here without mixing into your own library."
        />
      ) : (
        <div className="space-y-8 px-5 pb-24 pt-5">
          {folders.length > 0 && (
            <Section title="Folders">
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                {folders.map((folder) => (
                  <Link
                    key={folder.id}
                    to={`/folders/${folder.id}`}
                    className="flex items-center gap-3 rounded-panel border border-border-subtle bg-surface-raised px-3.5 py-3 transition hover:border-primary hover:bg-surface-sunken"
                  >
                    <Folder size={18} className="shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{folder.name}</span>
                      <span className="block text-xs text-content-muted">Shared folder · {folder.assetCount} items</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {albums.length > 0 && (
            <Section title="Albums">
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
                {albums.map((album) => (
                  <Link
                    key={album.id}
                    to={`/albums/${album.id}`}
                    className="overflow-hidden rounded-panel border border-border-subtle bg-surface-raised transition hover:border-primary"
                  >
                    <span className="block aspect-[4/3] overflow-hidden bg-surface-sunken"><AlbumCover album={album} /></span>
                    <span className="block px-3 py-2.5">
                      <span className="block truncate text-sm font-medium">{album.name}</span>
                      <span className="mt-0.5 block text-xs text-content-muted">Shared album · {album.assetCount} items</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {assets.length > 0 && (
            <Section title="Photos">
              <JustifiedGrid
                assets={assets}
                targetRowHeight={user?.preferences.tileSize ?? 220}
                onOpen={setViewing}
              />
            </Section>
          )}
        </div>
      )}

      {viewing && (
        <AssetViewer asset={viewing} assets={assets} onClose={() => setViewing(null)} onNavigate={setViewing} />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted">{title}</h2>
      {children}
    </section>
  );
}
