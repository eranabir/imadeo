import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PawPrint, Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { Button, Chip, Dialog, Input } from '../ui';

interface Subject {
  id: string;
  name: string;
  thumbnailPath: string;
  thumbnailUpdatedAt?: string;
  faceCount: number;
  kind: 'PERSON' | 'PET';
  species: string | null;
}

interface Props {
  open: boolean;
  /** The photos being assigned. */
  assetIds: string[];
  onClose: () => void;
  onError?: (message: string) => void;
}

/**
 * Says who is in a photo when the recognition did not work it out.
 *
 * Deliberately does not require a detection. When the models found a face or an
 * animal, that detection moves onto the chosen subject; when they found nothing
 * the photo is linked by hand instead. Requiring a detection would withhold the
 * feature exactly when recognition has failed, which is the only time anyone
 * needs to state it themselves.
 */
export function AssignSubjectDialog({ open, assetIds, onClose, onError }: Props) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'PERSON' | 'PET'>('PERSON');
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState('');

  const { data: subjects = [] } = useQuery({
    queryKey: ['people', 'assignable', kind],
    queryFn: async () =>
      (await api.get<Subject[]>('/people', { params: { minFaces: 1, withHidden: true, kind } }))
        .data,
    enabled: open,
  });

  /** The detections inside the chosen photos, which is what actually moves. */
  const { data: faces = [] } = useQuery({
    queryKey: ['assets', 'faces', assetIds],
    queryFn: async () =>
      (await api.post<{ id: string; kind: 'PERSON' | 'PET' }[]>('/people/faces/in-assets', {
        assetIds,
      })).data,
    enabled: open && assetIds.length > 0,
  });

  const matching = faces.filter((face) => face.kind === kind);

  const assign = useMutation({
    mutationFn: async (personId: string) =>
      // Photos, not detections: the server moves a detection when there is one
      // and records a manual link when there is not.
      (await api.post(`/people/${personId}/assets`, { assetIds })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => onError?.(errorMessage(e)),
  });

  const createAndAssign = useMutation({
    mutationFn: async (name: string) => {
      const { data: person } = await api.post<Subject>('/people', { name, kind });
      await api.post(`/people/${person.id}/assets`, { assetIds });
      return person;
    },
    onSuccess: () => {
      setCreating('');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (e) => onError?.(errorMessage(e)),
  });

  const needle = filter.trim().toLowerCase();
  const shown = subjects.filter((s) => !needle || s.name.toLowerCase().includes(needle));

  return (
    <Dialog
      open={open}
      title={assetIds.length > 1 ? `Who is in these ${assetIds.length} photos?` : 'Who is in this photo?'}
      description="Pick who these photos are of, or start a new one."
      onClose={onClose}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={kind === 'PERSON'} icon={<UserRound size={13} />} onClick={() => setKind('PERSON')}>
            People
          </Chip>
          <Chip active={kind === 'PET'} icon={<PawPrint size={13} />} onClick={() => setKind('PET')}>
            Pets
          </Chip>
        </div>

        <>
            {/* Nothing detected is the case where saying so by hand matters
                most, so it is a note rather than a dead end. */}
            <p className="text-xs text-content-muted">
              {matching.length > 0
                ? `${matching.length} ${matching.length === 1 ? 'detection' : 'detections'} will move.`
                : kind === 'PET'
                  ? 'No cat or dog was detected here, so these photos will simply be marked as theirs.'
                  : 'No face was detected here, so these photos will simply be marked as theirs.'}
            </p>

            <Input
              placeholder={kind === 'PET' ? 'Filter pets…' : 'Filter people…'}
              value={filter}
              size="sm"
              onChange={(event) => setFilter(event.target.value)}
            />

            <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {shown.map((subject) => (
                <button
                  key={subject.id}
                  type="button"
                  disabled={assign.isPending}
                  onClick={() => assign.mutate(subject.id)}
                  className="rounded-control p-1.5 text-center transition hover:bg-surface-sunken disabled:opacity-50"
                >
                  <span className="mx-auto block aspect-square w-full overflow-hidden rounded-full bg-surface-sunken">
                    {subject.thumbnailPath ? (
                      <img
                        src={`/api/people/${subject.id}/thumbnail.jpg?v=${encodeURIComponent(subject.thumbnailUpdatedAt ?? '')}`}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-content-muted">
                        {kind === 'PET' ? <PawPrint size={18} /> : <UserRound size={18} />}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[11px] font-medium">
                    {subject.name || <span className="text-content-muted">Unnamed</span>}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex gap-2 border-t border-border-subtle pt-3">
              <Input
                placeholder={kind === 'PET' ? 'Or a new pet’s name' : 'Or a new person’s name'}
                value={creating}
                size="sm"
                onChange={(event) => setCreating(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && creating.trim()) createAndAssign.mutate(creating.trim());
                }}
              />
              <Button
                size="sm"
                variant="primary"
                icon={<Plus size={14} />}
                disabled={!creating.trim() || createAndAssign.isPending}
                onClick={() => createAndAssign.mutate(creating.trim())}
              >
                Create
              </Button>
            </div>
        </>
      </div>
    </Dialog>
  );
}
