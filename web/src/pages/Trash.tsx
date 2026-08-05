import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage } from '../lib/api';
import { useSelection } from '../lib/useSelection';
import { formatDate } from '../lib/format';
import { useAuth } from '../store/auth';
import type { Asset } from '../types';
import { Button, ConfirmDialog, EmptyState } from '../ui';

export function Trash() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { selected, toggle, selectRange, setAnchor, clear } = useSelection<Asset>();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'selected' | 'all' | null>(null);

  const actions = useLibraryActions({ trashed: true, selectedIds: [...selected] });

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets', 'trash'],
    queryFn: async () => (await api.get<Asset[]>('/assets/trash')).data,
  });

  const afterChange = () => {
    clear();
    return queryClient.invalidateQueries();
  };
  const onError = (e: unknown) => setError(errorMessage(e));

  const restore = useMutation({
    mutationFn: async (ids: string[]) => (await api.post('/assets/trash/restore', { ids })).data,
    onSuccess: afterChange,
    onError,
  });

  const restoreAll = useMutation({
    mutationFn: async () => (await api.post('/assets/trash/restore-all')).data,
    onSuccess: afterChange,
    onError,
  });

  const deleteForever = useMutation({
    mutationFn: async (ids: string[]) =>
      (await api.delete('/assets', { data: { ids, force: true } })).data,
    onSuccess: afterChange,
    onError,
  });

  const emptyTrash = useMutation({
    mutationFn: async () => (await api.post('/assets/trash/empty')).data,
    onSuccess: afterChange,
    onError,
  });

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Trash</h1>
          <span className="text-xs text-content-muted">
            {isLoading
              ? ''
              : assets.length === 0
                ? 'Empty'
                : `${assets.length} items · removed automatically after 30 days`}
          </span>
        </div>

        {assets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 ? (
              <>
                <Button
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={() => restore.mutate([...selected])}
                >
                  Restore {selected.size}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  onClick={() => setConfirm('selected')}
                >
                  Delete forever
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={() => restoreAll.mutate()}
                >
                  Restore all
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  onClick={() => setConfirm('all')}
                >
                  Empty trash
                </Button>
              </>
            )}
          </div>
        )}
      </header>

      {error && (
        <p className="mx-5 mt-4 rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {assets.length === 0 && !isLoading ? (
        <EmptyState
          icon={Trash2}
          title="The trash is empty"
          description="Deleted photos wait here for 30 days before they are removed for good."
        />
      ) : (
        <div className="px-2 pb-24 pt-3">
          <p className="mb-3 px-3 text-xs text-content-muted">
            Click to select, or right-click a photo for more.
            {assets[0]?.purgeAt &&
              ` The oldest item is removed on ${formatDate(assets[0].purgeAt, user?.preferences.locale)}.`}
          </p>
          <JustifiedGrid
            assets={assets}
            selected={selected}
            targetRowHeight={user?.preferences.tileSize ?? 220}
            onOpen={toggle}
            onToggleSelect={toggle}
            onSelectRange={(a) => selectRange(a, assets)}
            onAnchor={setAnchor}
            onContextMenu={actions.onAssetContextMenu}
          />
        </div>
      )}

      {actions.overlays}

      <ConfirmDialog
        open={confirm === 'selected'}
        title={`Permanently delete ${selected.size} items?`}
        description="The files are removed from disk. This cannot be undone."
        confirmLabel="Delete forever"
        destructive
        onConfirm={() => deleteForever.mutate([...selected])}
        onClose={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirm === 'all'}
        title="Empty the trash?"
        description={`All ${assets.length} items are removed from disk. This cannot be undone.`}
        confirmLabel="Empty trash"
        destructive
        onConfirm={() => emptyTrash.mutate()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
