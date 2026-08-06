import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  CopyCheck,
  FolderPlus,
  FolderTree as FolderTreeIcon,
  Heart,
  Images,
  LayoutGrid,
  Lock,
  ScanFace,
  Settings as SettingsIcon,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useAuth } from '../store/auth';
import { useTree } from '../store/tree';
import type { FolderNode, UserStatistics } from '../types';
import { isDragging, readDrag } from '../lib/dnd';
import { PromptDialog } from '../ui';
import { FolderTree } from './FolderTree';
import { TopBar } from './TopBar';
import { useLibraryActions } from './useLibraryActions';

/** Each entry gets its own tint so the rail reads as a photo app, not a console. */
const NAV = [
  { to: '/', label: 'Photos', icon: Images, tint: 'text-cyan-500', end: true },
  { to: '/albums', label: 'Albums', icon: LayoutGrid, tint: 'text-amber-500', end: false },
  // Folders is an ordinary destination like the rest; the tree below it is
  // just a shortcut into that page, not a separate concept.
  // `end: false` so viewing any folder keeps this entry marked, the way an
  // album keeps Albums marked.
  { to: '/folders', label: 'Folders', icon: FolderTreeIcon, tint: 'text-violet-500', end: false },
  // ScanFace rather than a group-of-people glyph: the section is about
  // recognition, and any icon showing people would quietly imply pets are a
  // lesser guest there.
  { to: '/people', label: 'People & Pets', icon: ScanFace, tint: 'text-sky-500', end: false },
  { to: '/favorites', label: 'Favorites', icon: Heart, tint: 'text-rose-500', end: false },
  { to: '/locked', label: 'Locked', icon: Lock, tint: 'text-indigo-400', end: false },
  { to: '/duplicates', label: 'Duplicates', icon: CopyCheck, tint: 'text-orange-500', end: false },
  { to: '/trash', label: 'Trash', icon: Trash2, tint: 'text-slate-400', end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, tint: 'text-emerald-500', end: false },
] as const;

export function Layout() {
  const navigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const { data: duplicateGroups } = useQuery({
    queryKey: ['assets', 'duplicates', 'count'],
    queryFn: async () => (await api.get<{ groups: number }>('/assets/duplicates/count')).data,
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['folders', 'tree'],
    queryFn: async () =>
      (await api.get<FolderNode[]>('/folders/tree', { params: { recursiveCounts: true } })).data,
  });

  // The user endpoint carries disk numbers as well as the library counts.
  const { data: stats } = useQuery({
    queryKey: ['users', 'statistics'],
    queryFn: async () => (await api.get<UserStatistics>('/users/me/statistics')).data,
  });

  // Keep the branch leading to the folder being viewed open.
  const expandPath = useTree((state) => state.expandPath);
  useEffect(() => {
    if (!params.folderId) return;
    const find = (nodes: FolderNode[]): FolderNode | null => {
      for (const node of nodes) {
        if (node.id === params.folderId) return node;
        const hit = find(node.children);
        if (hit) return hit;
      }
      return null;
    };
    const current = find(folders);
    if (current) expandPath(current.path.split('/').filter(Boolean));
  }, [params.folderId, folders, expandPath]);

  const createFolder = useMutation({
    mutationFn: async (name: string) => (await api.post('/folders', { name })).data,
    onSuccess: (folder: FolderNode) => {
      void queryClient.invalidateQueries({ queryKey: ['folders'] });
      navigate(`/folders/${folder.id}`);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  // Folders, albums and photos all move through the same shared hook.
  const actions = useLibraryActions({ onError: setError });
  const [rootDrop, setRootDrop] = useState(false);
  /** True while any drag is in flight, so drop hints only appear when useful. */
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    const start = () => setDragActive(true);
    const stop = () => {
      setDragActive(false);
      setRootDrop(false);
    };
    window.addEventListener('dragstart', start);
    window.addEventListener('dragend', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragend', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const badgeFor = (label: string) =>
    label === 'Trash'
      ? stats?.trashed
      : label === 'Favorites'
        ? stats?.favorites
        : label === 'Duplicates'
          ? duplicateGroups?.groups
          : undefined;

  /**
   * A per-account quota is the real ceiling when one is set. Without one the
   * limit is the disk itself, so fall back to the volume's own numbers.
   */
  const quota = user?.quotaSizeInBytes ? Number(user.quotaSizeInBytes) : null;
  const used = stats ? Number(stats.usageInBytes) : 0;
  const diskTotal = stats?.disk?.totalBytes ?? null;
  const diskFree = stats?.disk?.availableBytes ?? null;

  const capacity = quota ?? diskTotal;
  const free = quota !== null ? Math.max(0, quota - used) : diskFree;
  const percent =
    capacity !== null && capacity > 0
      ? Math.min(100, ((quota !== null ? used : (stats?.disk?.usedBytes ?? used)) / capacity) * 100)
      : null;

  return (
    <div className="flex h-full flex-col">
      <TopBar stats={stats} />

      <div className="flex min-h-0 flex-1">
        {/* The rail itself does not scroll — only the nav inside it does. When
            the whole rail scrolled, the storage card scrolled away with it, and
            the scrollbar sat on top of the entries. */}
        <aside className="hidden w-60 shrink-0 flex-col overflow-hidden px-3 pb-4 pt-4 md:flex">
          {/* `min-h-0` lets this shrink below its content so it can scroll. The
              bar itself is hidden: in a 240px rail it sat over the labels, and
              reserving a gutter for it just moved the problem into a permanent
              empty strip. */}
          <nav className="scrollbar-hidden min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {NAV.map(({ to, label, icon: Icon, tint, end }) => {
              const badge = badgeFor(label);
              return (
                <div key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    clsx(
                      'group flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm transition',
                      isActive
                        ? 'bg-accent-soft font-semibold text-accent'
                        : 'text-content hover:bg-surface-sunken',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        size={18}
                        className={clsx('shrink-0 transition', isActive ? 'text-accent' : tint)}
                      />
                      <span className="flex-1">{label}</span>

                      {/* Creating a folder belongs on the Folders row rather
                          than in a heading of its own. */}
                      {to === '/folders' && (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="New folder"
                          title="New folder"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setNewFolderOpen(true);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            setNewFolderOpen(true);
                          }}
                          className="grid h-6 w-6 place-items-center rounded-full text-content-muted opacity-0 transition hover:bg-surface-raised hover:text-content group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <FolderPlus size={14} />
                        </span>
                      )}

                      {/* Same treatment as the counts on the folder tree below,
                          so one rail does not use two styles for one idea. */}
                      {badge ? (
                        <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                          {badge}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>

                {/* The tree belongs to the Folders entry, so it is rendered
                    inline underneath it rather than at the foot of the rail. */}
                {to === '/folders' && (
                  // A little breathing room so the tree reads as belonging to
                  // the Folders row rather than colliding with it. No scroller
                  // of its own — the nav around it already scrolls, and nesting
                  // a second one meant two bars and a tree you had to scroll
                  // twice to get through.
                  <div className="mt-1.5 pb-2">
                    <FolderTree
                      folders={folders}
                      activeId={params.folderId}
                      onDropOnFolder={actions.dropOnFolder}
                      onDropOnAlbum={actions.dropOnAlbum}
                      onFolderContextMenu={actions.onFolderContextMenu}
                      onAlbumContextMenu={actions.onAlbumContextMenu}
                    />

                    {/* Only takes up room while something is actually being
                        dragged; rendered permanently it left a dead strip. */}
                    {dragActive && (
                      <div
                        onDragOver={(event) => {
                          if (!isDragging(event)) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setRootDrop(true);
                        }}
                        onDragLeave={() => setRootDrop(false)}
                        onDrop={(event) => {
                          event.preventDefault();
                          setRootDrop(false);
                          const payload = readDrag(event);
                          if (payload) actions.dropOnRoot(payload);
                        }}
                        className={clsx(
                          'mx-1 mt-1 rounded-md border border-dashed px-3 py-1.5 text-[11px] transition',
                          rootDrop
                            ? 'border-accent bg-accent text-white'
                            : 'border-border-strong text-content-muted',
                        )}
                      >
                        Move to the top level
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </nav>

          {/* ---- storage ---- */}
          {/* Outside the scrolling nav, so it stays put at the foot of the rail
              however long the folder tree grows. */}
          <NavLink
            to="/settings?section=storage"
            className="mt-3 block shrink-0 rounded-panel bg-surface-sunken px-4 py-3 transition hover:bg-border-subtle/60"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium">Storage</span>
              <span className="text-[11px] tabular-nums text-content-muted">
                {percent === null ? formatBytes(used) : `${Math.round(percent)}%`}
              </span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-border-subtle">
              <div
                className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-600 transition-[width]"
                style={{ width: `${percent ?? 6}%` }}
              />
            </div>

            <p className="mt-1.5 text-[11px] leading-relaxed text-content-muted">
              {capacity !== null ? (
                <>
                  {formatBytes(used)} of {formatBytes(capacity)} used
                  <br />
                  {formatBytes(free!)} free
                </>
              ) : (
                `${formatBytes(used)} used`
              )}
            </p>
          </NavLink>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {error && (
            <div className="flex items-center justify-between gap-4 bg-danger-soft px-5 py-2 text-sm text-danger">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} className="font-medium">
                Dismiss
              </button>
            </div>
          )}
          <Outlet context={{ setError }} />
        </main>
      </div>

      {actions.overlays}

      <PromptDialog
        open={newFolderOpen}
        title="New folder"
        description="Folders can hold photos, albums and other folders."
        label="Folder name"
        placeholder="Holidays"
        onSubmit={(name) => createFolder.mutate(name)}
        onClose={() => setNewFolderOpen(false)}
      />
    </div>
  );
}

