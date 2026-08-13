import { useQuery } from '@tanstack/react-query';
import { Folder, Link2, Share2, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlbumCover } from '../components/AlbumCover';
import { AssetViewer } from '../components/AssetViewer';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import type { Album, Asset, FolderNode, Paginated } from '../types';
import { Chip, EmptyState, Loading } from '../ui';

const flatten = (nodes: FolderNode[]): FolderNode[] =>
  nodes.flatMap((folder) => [folder, ...flatten(folder.children)]);

interface Recipient {
  id: string;
  name: string;
  email: string;
  role?: 'VIEWER' | 'EDITOR';
}

interface SharedLink {
  id: string;
  type: 'ALBUM' | 'INDIVIDUAL';
  url: string;
  description: string | null;
  album: { id: string; name: string } | null;
  assetCount: number;
  hasPassword: boolean;
  isExpired: boolean;
}

interface SharingOverview {
  assets: { asset: Asset; recipients: Recipient[] }[];
  albums: (Album & { recipients: Recipient[] })[];
  folders: { id: string; name: string; assetCount: number; recipients: Recipient[] }[];
  links: SharedLink[];
}

/** Everything going out from this account and coming in from other accounts. */
export function Sharing() {
  const { user } = useAuth();
  const [direction, setDirection] = useState<'OUTGOING' | 'INCOMING'>('OUTGOING');
  const [viewing, setViewing] = useState<Asset | null>(null);
  const outgoingQuery = useQuery({
    queryKey: ['sharing', 'outgoing'],
    queryFn: async () => (await api.get<SharingOverview>('/shared-links/overview')).data,
  });
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

  if (
    outgoingQuery.isLoading ||
    assetsQuery.isLoading ||
    albumsQuery.isLoading ||
    foldersQuery.isLoading
  ) {
    return <Loading label="Loading shared items…" />;
  }

  const incomingAssets = (assetsQuery.data?.items ?? []).filter((asset) => asset.ownerId !== user?.id);
  const incomingAlbums = (albumsQuery.data ?? []).filter((album) => album.owner?.id !== user?.id);
  const incomingFolders = flatten(foldersQuery.data ?? []).filter((folder) => folder.shared);
  const outgoing = outgoingQuery.data ?? { assets: [], albums: [], folders: [], links: [] };
  const outgoingAssets = outgoing.assets.map(({ asset }) => asset);
  const incomingEmpty = !incomingAssets.length && !incomingAlbums.length && !incomingFolders.length;
  const outgoingEmpty =
    !outgoing.assets.length && !outgoing.albums.length && !outgoing.folders.length && !outgoing.links.length;
  const viewerAssets = direction === 'OUTGOING' ? outgoingAssets : incomingAssets;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Share2 size={18} className="text-secondary" />
          <h1 className="text-lg font-semibold tracking-tight">Sharing</h1>
        </div>
        <p className="mt-0.5 text-sm text-content-muted">See what you share and what other accounts share with you.</p>
        <div className="mt-3 flex gap-2">
          <Chip
            active={direction === 'OUTGOING'}
            icon={<Share2 size={13} />}
            onClick={() => { setDirection('OUTGOING'); setViewing(null); }}
          >
            Shared by me
          </Chip>
          <Chip
            active={direction === 'INCOMING'}
            icon={<Users size={13} />}
            onClick={() => { setDirection('INCOMING'); setViewing(null); }}
          >
            Shared with me
          </Chip>
        </div>
      </header>

      {direction === 'OUTGOING' && outgoingEmpty ? (
        <EmptyState
          icon={Share2}
          title="You are not sharing anything yet"
          description="Photos, albums, folders, and public links you share will appear here."
        />
      ) : direction === 'INCOMING' && incomingEmpty ? (
        <EmptyState
          icon={Users}
          title="Nothing shared with you yet"
          description="When another account shares a photo, album, or folder, it appears here without mixing into your own library."
        />
      ) : direction === 'OUTGOING' ? (
        <div className="space-y-8 px-5 pb-24 pt-5">
          {outgoing.folders.length > 0 && (
            <Section title="Folders">
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                {outgoing.folders.map((folder) => (
                  <SharedPlaceCard
                    key={folder.id}
                    to={`/folders/${folder.id}`}
                    icon={<Folder size={18} className="shrink-0 text-nav-folders" />}
                    name={folder.name}
                    detail={`${folder.assetCount} items`}
                    recipients={folder.recipients}
                  />
                ))}
              </div>
            </Section>
          )}

          {outgoing.albums.length > 0 && (
            <Section title="Albums">
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
                {outgoing.albums.map((album) => (
                  <Link
                    key={album.id}
                    to={`/albums/${album.id}`}
                    className="overflow-hidden rounded-panel border border-border-subtle bg-surface-raised transition hover:border-primary"
                  >
                    <span className="block aspect-[4/3] overflow-hidden bg-surface-sunken"><AlbumCover album={album} /></span>
                    <span className="block px-3 py-2.5">
                      <span className="block truncate text-sm font-medium">{album.name}</span>
                      <span className="mt-0.5 block text-xs text-content-muted">
                        {album.assetCount} items · {recipientLabel(album.recipients)}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {outgoing.assets.length > 0 && (
            <Section title="Photos">
              <JustifiedGrid assets={outgoingAssets} targetRowHeight={user?.preferences.tileSize ?? 220} onOpen={setViewing} />
              <p className="mt-2 text-xs text-content-muted">
                {outgoing.assets.length} {outgoing.assets.length === 1 ? 'photo' : 'photos'} shared with other accounts
              </p>
            </Section>
          )}

          {outgoing.links.length > 0 && (
            <Section title="Public links">
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
                {outgoing.links.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-panel border border-border-subtle bg-surface-raised px-3.5 py-3 transition hover:border-primary hover:bg-surface-sunken"
                  >
                    <Link2 size={18} className="shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{link.album?.name ?? link.description ?? 'Shared photos'}</span>
                      <span className="block text-xs text-content-muted">
                        {link.isExpired ? 'Expired link' : link.hasPassword ? 'Password-protected link' : 'Public link'}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            </Section>
          )}
        </div>
      ) : (
        <div className="space-y-8 px-5 pb-24 pt-5">
          {incomingFolders.length > 0 && (
            <Section title="Folders">
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                {incomingFolders.map((folder) => (
                  <Link
                    key={folder.id}
                    to={`/folders/${folder.id}`}
                    className="flex items-center gap-3 rounded-panel border border-border-subtle bg-surface-raised px-3.5 py-3 transition hover:border-primary hover:bg-surface-sunken"
                  >
                    <Folder size={18} className="shrink-0 text-nav-folders" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{folder.name}</span>
                      <span className="block text-xs text-content-muted">Shared folder · {folder.assetCount} items</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {incomingAlbums.length > 0 && (
            <Section title="Albums">
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
                {incomingAlbums.map((album) => (
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

          {incomingAssets.length > 0 && (
            <Section title="Photos">
              <JustifiedGrid
                assets={incomingAssets}
                targetRowHeight={user?.preferences.tileSize ?? 220}
                onOpen={setViewing}
              />
            </Section>
          )}
        </div>
      )}

      {viewing && (
        <AssetViewer asset={viewing} assets={viewerAssets} onClose={() => setViewing(null)} onNavigate={setViewing} />
      )}
    </div>
  );
}

const recipientLabel = (recipients: Recipient[]) =>
  recipients.length === 1 ? `Shared with ${recipients[0].name}` : `Shared with ${recipients.length} people`;

function SharedPlaceCard({
  to,
  icon,
  name,
  detail,
  recipients,
}: {
  to: string;
  icon: React.ReactNode;
  name: string;
  detail: string;
  recipients: Recipient[];
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-panel border border-border-subtle bg-surface-raised px-3.5 py-3 transition hover:border-primary hover:bg-surface-sunken"
    >
      {icon}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block text-xs text-content-muted">{detail} · {recipientLabel(recipients)}</span>
      </span>
    </Link>
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
