import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Mail, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Album } from '../types';
import { Button, Dialog, IconButton, Input, Select } from '../ui';

interface InviteResult {
  user: { id: string; email: string; name: string };
  accountCreated: boolean;
  emailSent: boolean;
  temporaryPassword?: string;
  albumUrl: string;
}

interface SharedLink {
  id: string;
  url: string;
  hasPassword: boolean;
  albumId: string | null;
}

export function ShareDialog({
  album,
  open,
  onClose,
}: {
  album: Album & { albumUsers?: { userId: string; role: string; user: { id: string; name: string; email?: string } }[] };
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'VIEWER' | 'EDITOR'>('VIEWER');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: links = [] } = useQuery({
    queryKey: ['shared-links'],
    queryFn: async () => (await api.get<SharedLink[]>('/shared-links')).data,
    enabled: open,
  });

  const publicLink = links.find((link) => link.albumId === album.id);

  const invite = useMutation({
    mutationFn: async () =>
      (await api.post<InviteResult>(`/albums/${album.id}/invite`, { email, role })).data,
    onSuccess: (data) => {
      setResult(data);
      setEmail('');
      void queryClient.invalidateQueries();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => api.delete(`/albums/${album.id}/user/${userId}`),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e) => setError(errorMessage(e)),
  });

  const createLink = useMutation({
    mutationFn: async () =>
      (await api.post('/shared-links', { type: 'ALBUM', albumId: album.id })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shared-links'] }),
    onError: (e) => setError(errorMessage(e)),
  });

  const revokeLink = useMutation({
    mutationFn: async (id: string) => api.delete(`/shared-links/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shared-links'] }),
    onError: (e) => setError(errorMessage(e)),
  });

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setResult(null);
        setError(null);
        onClose();
      }}
      width="md"
      title={`Share “${album.name}”`}
      description="Invite people by email, or hand out a link anyone can open."
    >
      <div className="space-y-5">
        {/* ---- invite by email ---- */}
        <div>
          <div className="flex items-end gap-2">
            <Input
              label="Invite by email"
              type="email"
              placeholder="them@example.com"
              adornment={<Mail size={15} />}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && email.trim()) invite.mutate();
              }}
            />
            <Select
              value={role}
              onChange={setRole}
              options={[
                { value: 'VIEWER', label: 'Can view' },
                { value: 'EDITOR', label: 'Can add photos' },
              ]}
            />
            <Button
              variant="primary"
              icon={<UserPlus size={15} />}
              disabled={!email.trim() || invite.isPending}
              onClick={() => invite.mutate()}
            >
              Invite
            </Button>
          </div>

          {result && (
            <div className="mt-3 rounded-control bg-surface-sunken px-3.5 py-3 text-xs">
              <p className="font-medium text-content">
                {result.emailSent
                  ? `Invite emailed to ${result.user.email}.`
                  : `${result.user.email} was added, but no email could be sent.`}
              </p>

              {/* Without a mail relay the operator has to pass these on by hand. */}
              {!result.emailSent && (
                <div className="mt-2 space-y-1.5 text-content-muted">
                  <p>Send them this link:</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1">
                      {result.albumUrl}
                    </code>
                    <IconButton
                      label="Copy link"
                      size="sm"
                      onClick={() => void copy(result.albumUrl)}
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                    </IconButton>
                  </div>
                  {result.temporaryPassword && (
                    <p>
                      A new account was created. Temporary password:{' '}
                      <code className="rounded bg-surface px-1.5 py-0.5">
                        {result.temporaryPassword}
                      </code>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- who already has access ---- */}
        {album.albumUsers && album.albumUsers.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-content-muted">People with access</p>
            <ul className="space-y-1">
              {album.albumUsers.map((member) => (
                <li
                  key={member.userId}
                  className="flex items-center gap-2.5 rounded-control px-2.5 py-2 hover:bg-surface-sunken"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-secondary to-primary-deep text-[11px] font-semibold text-white">
                    {member.user.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{member.user.name}</span>
                    <span className="block truncate text-[11px] text-content-muted">
                      {member.role === 'EDITOR' ? 'Can add photos' : 'Can view'}
                    </span>
                  </span>
                  <IconButton
                    label="Remove access"
                    size="sm"
                    onClick={() => removeMember.mutate(member.userId)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- public link ---- */}
        <div>
          <p className="mb-2 text-xs font-medium text-content-muted">Link sharing</p>

          {publicLink ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-control bg-surface-sunken px-3 py-2 text-xs">
                {publicLink.url}
              </code>
              <IconButton label="Copy link" onClick={() => void copy(publicLink.url)}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </IconButton>
              <Button size="sm" variant="danger" onClick={() => revokeLink.mutate(publicLink.id)}>
                Revoke
              </Button>
            </div>
          ) : (
            <Button
              icon={<Link2 size={15} />}
              disabled={createLink.isPending}
              onClick={() => createLink.mutate()}
            >
              Create a public link
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
