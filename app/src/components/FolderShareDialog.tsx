import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { Button, Checkbox, Dialog } from '../ui';

interface Peer {
  id: string;
  name: string;
  email: string;
}

/** Gives chosen accounts read-only access to a folder and its subtree. */
export function FolderShareDialog({
  folderId,
  folderName,
  open,
  onClose,
}: {
  folderId: string;
  folderName: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const { data: peers = [], isLoading } = useQuery({
    queryKey: ['share-peers'],
    queryFn: async () => (await api.get<Peer[]>('/users')).data,
    enabled: open,
  });
  const share = useMutation({
    mutationFn: async () => api.post(`/folders/${folderId}/users`, { userIds: [...selected] }),
    onSuccess: () => {
      setSelected(new Set());
      setError(null);
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (cause) => setError(errorMessage(cause)),
  });
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog
      open={open}
      onClose={() => {
        setSelected(new Set());
        setError(null);
        onClose();
      }}
      width="sm"
      title={`Share “${folderName}”`}
      description="People you choose can view this folder, its albums, and everything inside it. They cannot change your library."
    >
      <div className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-content-muted">Loading accounts…</p>
        ) : peers.length ? (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-control bg-surface-sunken p-1.5">
            {peers.map((person) => (
              <Checkbox
                key={person.id}
                checked={selected.has(person.id)}
                onChange={(checked) => toggle(person.id, checked)}
                className="rounded-control px-2.5 py-2 hover:bg-surface-raised"
                label={
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-content">{person.name}</span>
                    <span className="block truncate text-xs text-content-muted">{person.email}</span>
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-content-muted">There are no other accounts on this server yet.</p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button
          variant="primary"
          icon={<Share2 size={15} />}
          disabled={!selected.size || share.isPending}
          onClick={() => share.mutate()}
        >
          {share.isPending ? 'Sharing…' : 'Share folder'}
        </Button>
      </div>
    </Dialog>
  );
}
