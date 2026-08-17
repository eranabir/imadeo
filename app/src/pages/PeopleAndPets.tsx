import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Eye, EyeOff, Merge, PawPrint, Pencil, Star, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { Button, Chip, ConfirmDialog, EmptyState, Input, Menu, Progress, Tooltip } from '../ui';

interface Subject {
  id: string;
  name: string;
  thumbnailPath: string;
  thumbnailUpdatedAt: string;
  isHidden: boolean;
  isFavorite: boolean;
  faceCount: number;
  hasName: boolean;
  kind: 'PERSON' | 'PET';
  /** "cat" or "dog" for pets, null for people. */
  species: string | null;
}

interface FaceStatus {
  enabled: boolean;
  ready: boolean;
  videosEnabled: boolean;
  pendingAssets: number;
  /** Every media item a scan would look at, so the outstanding count means something. */
  totalAssets: number;
  /** Current upload/rescan batch, rather than the lifetime library total. */
  scanPendingAssets: number;
  scanTotalAssets: number;
  /** At least one recognition job is active, queued, or waiting to retry. */
  scanning: boolean;
}

export function PeopleAndPetsPage() {
  const queryClient = useQueryClient();

  /**
   * People and pets are the same machinery — detect, group, name, merge, correct
   * — so they share this page rather than duplicating it. They are kept in
   * separate tabs because merging across them is never what anyone wants.
   */
  const [kind, setKind] = useState<'ALL' | 'PERSON' | 'PET'>('ALL');
  const [showHidden, setShowHidden] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ subject: Subject; anchor: { x: number; y: number } } | null>(
    null,
  );
  const [confirmForget, setConfirmForget] = useState<Subject | null>(null);
  /** The subject whose name is currently being typed, edited inline on the card. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['subjects', 'status'],
    queryFn: async () => (await api.get<FaceStatus>('/people-and-pets/status')).data,
    // Uploads can start recognition after this page has already loaded. Keep
    // watching even at zero or a fast background job is never observed.
    refetchInterval: 4000,
  });

  /**
   * Uploads start recognition in the background. Remember the outstanding
   * count so finishing that work refreshes the cards and their photo counts.
   */
  const previousPending = useRef<number | null>(null);

  useEffect(() => {
    if (status) {
      if (previousPending.current !== null && previousPending.current > 0 && status.pendingAssets === 0) {
        void queryClient.invalidateQueries({ queryKey: ['subjects'] });
      }
      previousPending.current = status.pendingAssets;
    }
  }, [queryClient, status]);

  const scanTotal = status?.scanTotalAssets ?? status?.totalAssets ?? 0;
  const scanPending = status?.scanPendingAssets ?? status?.pendingAssets ?? 0;
  const scanned = scanTotal - scanPending;
  const mediaLabel = status?.videosEnabled ? 'photos and videos' : 'photos';

  const { data: subjects = [], isLoading } = useQuery({
    queryKey: ['subjects', showHidden, kind],
    queryFn: async () =>
      (
        await api.get<Subject[]>('/people-and-pets', {
          // Every group, however few photos it has. A server-side minimum was
          // hiding most of them with nothing on screen to say so, and a group
          // that cannot be seen cannot be merged into the right subject — which
          // is exactly what a two-face group usually needs.
          params: { withHidden: showHidden, minFaces: 1, ...(kind === 'ALL' ? {} : { kind }) },
        })
      ).data,
    // Recognition finishes independently of React Query. Polling this small
    // summary prevents a newly recognised pet from sitting behind a stale
    // card until the whole page is reloaded.
    refetchInterval: 4000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['subjects'] });
  const onError = (e: unknown) => setError(errorMessage(e));

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      (await api.put(`/people-and-pets/${id}`, { name })).data,
    onSuccess: invalidate,
    onError,
  });

  const setHidden = useMutation({
    mutationFn: async ({ id, isHidden }: { id: string; isHidden: boolean }) =>
      (await api.put(`/people-and-pets/${id}`, { isHidden })).data,
    onSuccess: invalidate,
    onError,
  });

  /**
   * Moves a subject between People and Pets.
   *
   * Detection decides which of the two something is, and it gets it wrong — a
   * dog photographed face-on lands among the people often enough that there had
   * to be a way to say so. The faces, name and cover move with it; a pet-only
   * cat or dog label is cleared when the group becomes a person.
   */
  const reclassify = useMutation({
    mutationFn: async ({ id, kind: next }: { id: string; kind: 'PERSON' | 'PET' }) =>
      (await api.put(`/people-and-pets/${id}`, { kind: next })).data,
    onSuccess: invalidate,
    onError,
  });

  const merge = useMutation({
    mutationFn: async ({ targetId, sourceIds }: { targetId: string; sourceIds: string[] }) =>
      (await api.post(`/people-and-pets/${targetId}/merge`, { sourceIds })).data,
    onSuccess: () => {
      setSelected(new Set());
      setSelecting(false);
      return invalidate();
    },
    onError,
  });

  const setFavorite = useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
      (await api.put(`/people-and-pets/${id}`, { isFavorite })).data,
    onSuccess: invalidate,
    onError,
  });

  const forget = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/people-and-pets/${id}`)).data,
    onSuccess: () => {
      setConfirmForget(null);
      return invalidate();
    },
    onError,
  });

  const forgetSelected = useMutation({
    mutationFn: async (subjectIds: string[]) =>
      (await api.delete('/people-and-pets', { data: { subjectIds } })).data,
    onSuccess: () => {
      setConfirmDeleteSelected(false);
      setSelected(new Set());
      setSelecting(false);
      return invalidate();
    },
    onError,
  });

  const visible = subjects;


  const toggle = (subject: Subject) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(subject.id)) next.delete(subject.id);
      else next.add(subject.id);
      return next;
    });
  };

  /**
   * Merging keeps the subject who already has a name, so folding an unnamed
   * group into "Anna" does not lose the name.
   */
  const mergeTarget = () => {
    const chosen = visible.filter((subject) => selected.has(subject.id));
    return chosen.find((subject) => subject.hasName) ?? chosen[0];
  };

  const target = mergeTarget();
  const selectedSubjects = visible.filter((subject) => selected.has(subject.id));

  /**
   * Only subjects of the target's own kind. Showing people and pets in one list
   * means a selection can now span both, and folding a dog into a person is
   * never what was meant.
   */
  const mergeSources = visible
    .filter((subject) => selected.has(subject.id) && subject.id !== target?.id)
    .filter((subject) => subject.kind === target?.kind);
  const canMerge =
    selectedSubjects.length >= 2 &&
    selectedSubjects.every((subject) => subject.kind === target?.kind);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight">People &amp; Pets</h1>
            <span className="text-xs tabular-nums text-content-muted">
              {isLoading
                ? ''
                : kind === 'PET'
                  ? `${visible.length} ${visible.length === 1 ? 'pet' : 'pets'}`
                  : kind === 'PERSON'
                    ? `${visible.length} ${visible.length === 1 ? 'person' : 'people'}`
                    : `${visible.length} in total`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selecting ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Merge size={14} />}
                  disabled={!canMerge || mergeSources.length === 0}
                  onClick={() => setConfirmMerge(true)}
                >
                  Merge {selected.size > 0 ? selected.size : ''}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  disabled={selected.size === 0}
                  onClick={() => setConfirmDeleteSelected(true)}
                >
                  Remove {selected.size > 0 ? selected.size : ''}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setSelecting(false);
                    setSelected(new Set());
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                icon={<Check size={14} />}
                disabled={visible.length < 1}
                onClick={() => setSelecting(true)}
              >
                Select
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip
            active={kind === 'ALL'}
            onClick={() => {
              setKind('ALL');
              setSelecting(false);
              setSelected(new Set());
            }}
          >
            All
          </Chip>
          <Chip
            active={kind === 'PERSON'}
            icon={<UserRound size={13} />}
            onClick={() => {
              setKind('PERSON');
              setSelecting(false);
              setSelected(new Set());
            }}
          >
            People
          </Chip>
          <Chip
            active={kind === 'PET'}
            icon={<PawPrint size={13} />}
            onClick={() => {
              setKind('PET');
              setSelecting(false);
              setSelected(new Set());
            }}
          >
            Pets
          </Chip>
          <span className="mx-1 h-4 w-px bg-border-subtle" />
          <Chip
            active={showHidden}
            icon={showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
            onClick={() => setShowHidden((value) => !value)}
          >
            {showHidden ? 'Showing hidden' : 'Show hidden'}
          </Chip>
        </div>
      </header>

      {error && (
        <p className="mx-5 mt-4 rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Recognition needs its own service, so say plainly when it is off. */}
      {status && !status.enabled && (
        <p className="mx-5 mt-4 rounded-control bg-surface-sunken px-3.5 py-2.5 text-sm text-content-muted">
          People &amp; Pets recognition is switched off on this server. An administrator can turn it on in
          Settings → Recognition.
        </p>
      )}

      {status?.enabled && !status.ready && (
        <p className="mx-5 mt-4 rounded-control bg-surface-sunken px-3.5 py-2.5 text-sm text-content-muted">
          The machine-learning service is starting up — the model takes a minute to load the first
          time.
        </p>
      )}

      {status?.ready && status.pendingAssets > 0 && status.scanning && (
        <div className="mx-5 mt-4 rounded-control bg-primary-soft px-3.5 py-2.5">
          <p className="text-sm text-primary">
            Scanning — {scanned.toLocaleString()} of {scanTotal.toLocaleString()} {mediaLabel} done ·{' '}
            {scanPending.toLocaleString()} remaining
          </p>
          <Progress
            value={scanned / Math.max(1, scanTotal)}
            label={`Scanning ${mediaLabel} for people and pets: ${scanned} of ${scanTotal} complete`}
            className="mt-2.5"
          />
        </div>
      )}

      {status?.ready && status.pendingAssets > 0 && !status.scanning && (
        <p className="mx-5 mt-4 rounded-control bg-surface-sunken px-3.5 py-2.5 text-sm text-warning">
          Recognition needs attention — {status.pendingAssets.toLocaleString()} {mediaLabel} remain. Continue
          from Settings → Recognition.
        </p>
      )}

      {!isLoading && visible.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No people or pets found yet"
          description={
            status?.ready
              ? `People and pets are grouped as ${mediaLabel} are scanned. Once a group has a few items in it, it shows up here.`
              : 'Once the machine-learning service is running, people and pets in your library are grouped here automatically.'
          }
        />
      ) : (
        <div className="grid gap-4 px-5 pb-24 pt-4 [grid-template-columns:repeat(auto-fill,minmax(124px,1fr))]">
          {visible.map((subject) => {
            const isSelected = selected.has(subject.id);

            return (
              <div
                key={subject.id}
                className="group relative"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ subject, anchor: { x: event.clientX, y: event.clientY } });
                }}
              >
                <Link
                  to={selecting ? '#' : `/people-and-pets/${subject.id}`}
                  onClick={(event) => {
                    if (selecting) {
                      event.preventDefault();
                      toggle(subject);
                    }
                  }}
                  className="block"
                >
                  <span
                    className={clsx(
                      'relative block aspect-square overflow-hidden rounded-full bg-surface-sunken transition',
                      isSelected
                        ? 'ring-3 ring-primary ring-offset-2 ring-offset-surface'
                        : 'group-hover:opacity-90',
                    )}
                  >
                    {subject.thumbnailPath ? (
                      <img
                        src={`/api/people-and-pets/${subject.id}/thumbnail.jpg?v=${encodeURIComponent(subject.thumbnailUpdatedAt)}`}
                        alt={subject.name || `Unnamed ${subject.kind === 'PET' ? 'pet' : 'person'}`}
                        loading="lazy"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-content-muted">
                        <UserRound size={30} strokeWidth={1.5} />
                      </span>
                    )}

                    {isSelected && (
                      <span className="absolute bottom-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-white">
                        <Check size={14} strokeWidth={3} />
                      </span>
                    )}
                  </span>

                </Link>

                {/* Outside the Link on purpose: clicking the name edits it,
                    clicking the face opens the subject. */}
                {editingId === subject.id ? (
                  <Input
                    autoFocus
                    defaultValue={subject.name}
                    placeholder="Add a name"
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') {
                        // Put the old value back so the blur below saves nothing new.
                        event.currentTarget.value = subject.name;
                        event.currentTarget.blur();
                      }
                    }}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim();
                      setEditingId(null);
                      if (name !== subject.name) rename.mutate({ id: subject.id, name });
                    }}
                    // `focus:outline-none` because the primary border already
                    // shows focus; without it the global focus ring sits
                    // outside the border and reads as a second box.
                    size="sm"
                    containerClassName="mt-2 w-full"
                    className="border-primary text-center font-medium focus:outline-none"
                  />
                ) : (
                  <Tooltip label={subject.name ? 'Click to rename' : 'Click to add a name'}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selecting) toggle(subject);
                      else setEditingId(subject.id);
                    }}
                    // A transparent border of the same width as the input's, so
                    // swapping one for the other does not change the height and
                    // shove the cards below it around.
                    className="mt-2 block w-full truncate rounded-control border border-transparent px-1.5 py-0.5 text-center text-sm font-medium transition hover:bg-surface-sunken"
                  >
                    {subject.name || <span className="text-content-muted">Add a name</span>}
                  </button>
                  </Tooltip>
                )}

                <span className="block text-center text-[11px] text-content-muted">
                  {subject.species ? `${subject.species} · ` : ''}
                  {subject.faceCount} {subject.faceCount === 1 ? 'item' : 'items'}
                </span>

                {/* No hover buttons over the face. Renaming is the name itself,
                    and everything else lives in the right-click menu — badges
                    floating over someone's photograph were only ever clutter. */}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmMerge}
        title={`Merge ${selected.size} groups into “${target?.name || 'one group'}”?`}
        description="Every matching item moves into the one group. This cannot be undone automatically, though you can split detections out again afterwards."
        confirmLabel="Merge"
        onConfirm={() => {
          if (!target) return;
          merge.mutate({ targetId: target.id, sourceIds: mergeSources.map((p) => p.id) });
        }}
        onClose={() => setConfirmMerge(false)}
      />

      <ConfirmDialog
        open={confirmDeleteSelected}
        title={`Remove ${selected.size} ${selected.size === 1 ? 'group' : 'groups'}?`}
        description="The groupings are discarded, but every media item stays exactly where it is. They may be regrouped the next time recognition is scanned."
        confirmLabel={`Remove ${selected.size}`}
        destructive
        onConfirm={() => forgetSelected.mutate([...selected])}
        onClose={() => setConfirmDeleteSelected(false)}
      />

      <ConfirmDialog
        open={Boolean(confirmForget)}
        title={`Remove ${
          confirmForget?.name || (confirmForget?.kind === 'PET' ? 'this pet' : 'this person')
        }?`}
        description="The grouping is discarded, but every media item stays exactly where it is. The detections may be regrouped the next time recognition runs."
        confirmLabel="Remove"
        destructive
        onConfirm={() => confirmForget && forget.mutate(confirmForget.id)}
        onClose={() => setConfirmForget(null)}
      />

      {menu && (
        <Menu
          anchor={menu.anchor}
          onDismiss={() => setMenu(null)}
          items={[
            {
              id: 'name',
              label: menu.subject.name ? 'Rename' : 'Add a name',
              icon: <Pencil size={15} />,
              onSelect: () => setEditingId(menu.subject.id),
            },
            {
              id: 'merge',
              // The main entry point for merging. The header button was easy to
              // miss, and starting from the subject you right-clicked is a far
              // more natural way in than "enter a mode, then pick two".
              label: 'Merge with…',
              icon: <Merge size={15} />,
              hint: 'Then pick who they are the same as',
              onSelect: () => {
                setSelecting(true);
                setSelected(new Set([menu.subject.id]));
              },
            },
            {
              id: 'favorite',
              label: menu.subject.isFavorite ? 'Remove from favourites' : 'Add to favourites',
              icon: <Star size={15} />,
              onSelect: () =>
                setFavorite.mutate({
                  id: menu.subject.id,
                  isFavorite: !menu.subject.isFavorite,
                }),
            },
            {
              id: 'kind',
              label: menu.subject.kind === 'PET' ? 'This is a person' : 'This is a pet',
              icon:
                menu.subject.kind === 'PET' ? <UserRound size={15} /> : <PawPrint size={15} />,
              hint: menu.subject.kind === 'PET' ? 'Move to People' : 'Move to Pets',
              onSelect: () =>
                reclassify.mutate({
                  id: menu.subject.id,
                  kind: menu.subject.kind === 'PET' ? 'PERSON' : 'PET',
                }),
            },
            {
              id: 'hide',
              label: menu.subject.isHidden ? 'Show again' : 'Hide from People & Pets',
              icon: menu.subject.isHidden ? <Eye size={15} /> : <EyeOff size={15} />,
              separated: true,
              onSelect: () =>
                setHidden.mutate({ id: menu.subject.id, isHidden: !menu.subject.isHidden }),
            },
            {
              id: 'forget',
              label: menu.subject.kind === 'PET' ? 'Remove this pet' : 'Remove this person',
              icon: <Trash2 size={15} />,
              hint: 'The media items are kept',
              danger: true,
              onSelect: () => setConfirmForget(menu.subject),
            },
          ]}
        />
      )}
    </div>
  );
}
