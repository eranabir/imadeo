import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Eye, EyeOff, Merge, PawPrint, Pencil, ScanFace, Star, Trash2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { Button, Chip, ConfirmDialog, EmptyState, Input, Menu, Progress, Tooltip } from '../ui';

interface Person {
  id: string;
  name: string;
  thumbnailPath: string;
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
  pendingAssets: number;
  /** Every photo a scan would look at, so the outstanding count means something. */
  totalAssets: number;
}

export function People() {
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
  const [menu, setMenu] = useState<{ person: Person; anchor: { x: number; y: number } } | null>(
    null,
  );
  const [confirmForget, setConfirmForget] = useState<Person | null>(null);
  /** The person whose name is currently being typed, edited inline on the card. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ['people', 'status'],
    queryFn: async () => (await api.get<FaceStatus>('/people/status')).data,
    // While a scan is running the pending count is what changes.
    refetchInterval: (query) => (query.state.data?.pendingAssets ? 4000 : false),
  });

  /**
   * Whether a scan is under way, as opposed to merely outstanding.
   *
   * Latched on the press rather than read from the queue: the server has no
   * "scanning" flag, only a count of what is left, and that count is just as
   * high the moment before the button is pressed as the moment after. Cleared
   * when the count reaches zero, or when the page is left. Completion also
   * refreshes the groups: the worker has written new results, but the grid's
   * query would otherwise still hold the empty response from before the scan.
   */
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (scanning && status && status.pendingAssets === 0) {
      setScanning(false);
      void queryClient.invalidateQueries({ queryKey: ['people'] });
    }
  }, [queryClient, scanning, status]);

  const scanned = status ? status.totalAssets - status.pendingAssets : 0;

  const { data: people = [], isLoading } = useQuery({
    queryKey: ['people', showHidden, kind],
    queryFn: async () =>
      (
        await api.get<Person[]>('/people', {
          // Every group, however few photos it has. A server-side minimum was
          // hiding most of them with nothing on screen to say so, and a group
          // that cannot be seen cannot be merged into the right person — which
          // is exactly what a two-face group usually needs.
          params: { withHidden: showHidden, minFaces: 1, ...(kind === 'ALL' ? {} : { kind }) },
        })
      ).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['people'] });
  const onError = (e: unknown) => setError(errorMessage(e));

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      (await api.put(`/people/${id}`, { name })).data,
    onSuccess: invalidate,
    onError,
  });

  const setHidden = useMutation({
    mutationFn: async ({ id, isHidden }: { id: string; isHidden: boolean }) =>
      (await api.put(`/people/${id}`, { isHidden })).data,
    onSuccess: invalidate,
    onError,
  });

  /**
   * Moves a subject between People and Pets.
   *
   * Detection decides which of the two something is, and it gets it wrong — a
   * dog photographed face-on lands among the people often enough that there had
   * to be a way to say so. Nothing else changes; the faces, the name and the
   * cover all go with it.
   */
  const reclassify = useMutation({
    mutationFn: async ({ id, kind: next }: { id: string; kind: 'PERSON' | 'PET' }) =>
      (await api.put(`/people/${id}`, { kind: next })).data,
    onSuccess: invalidate,
    onError,
  });

  const merge = useMutation({
    mutationFn: async ({ targetId, sourceIds }: { targetId: string; sourceIds: string[] }) =>
      (await api.post(`/people/${targetId}/merge`, { sourceIds })).data,
    onSuccess: () => {
      setSelected(new Set());
      setSelecting(false);
      return invalidate();
    },
    onError,
  });

  const scan = useMutation({
    onMutate: () => setScanning(true),
    mutationFn: async () => (await api.post('/people/scan')).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['people'] }),
    onError,
  });

  const setFavorite = useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
      (await api.put(`/people/${id}`, { isFavorite })).data,
    onSuccess: invalidate,
    onError,
  });

  const forget = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/people/${id}`)).data,
    onSuccess: () => {
      setConfirmForget(null);
      return invalidate();
    },
    onError,
  });

  const visible = people;


  const toggle = (person: Person) => {
    const hasDifferentKindSelected = visible.some(
      (selectedPerson) => selected.has(selectedPerson.id) && selectedPerson.kind !== person.kind,
    );
    if (!selected.has(person.id) && hasDifferentKindSelected) {
      setError('People and pets cannot be merged. Select groups of the same type.');
      return;
    }

    setSelected((current) => {
      const next = new Set(current);
      if (next.has(person.id)) next.delete(person.id);
      else next.add(person.id);
      return next;
    });
  };

  /**
   * Merging keeps the person who already has a name, so folding an unnamed
   * group into "Anna" does not lose the name.
   */
  const mergeTarget = () => {
    const chosen = visible.filter((person) => selected.has(person.id));
    return chosen.find((person) => person.hasName) ?? chosen[0];
  };

  const target = mergeTarget();

  /**
   * Only subjects of the target's own kind. Showing people and pets in one list
   * means a selection can now span both, and folding a dog into a person is
   * never what was meant.
   */
  const mergeSources = visible
    .filter((person) => selected.has(person.id) && person.id !== target?.id)
    .filter((person) => person.kind === target?.kind);

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
                  disabled={selected.size < 2 || mergeSources.length === 0}
                  onClick={() => setConfirmMerge(true)}
                >
                  Merge {selected.size > 0 ? selected.size : ''}
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
                icon={<Merge size={14} />}
                disabled={visible.length < 2}
                onClick={() => setSelecting(true)}
              >
                Merge
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

      {/* Face recognition needs its own service, so say plainly when it is off. */}
      {status && !status.enabled && (
        <p className="mx-5 mt-4 rounded-control bg-surface-sunken px-3.5 py-2.5 text-sm text-content-muted">
          Face recognition is switched off on this server. An administrator can turn it on in
          Settings → Recognition.
        </p>
      )}

      {status?.enabled && !status.ready && (
        <p className="mx-5 mt-4 rounded-control bg-surface-sunken px-3.5 py-2.5 text-sm text-content-muted">
          The machine-learning service is starting up — the model takes a minute to load the first
          time.
        </p>
      )}

      {status?.ready && status.pendingAssets > 0 && (
        <div className="mx-5 mt-4 rounded-control bg-primary-soft px-3.5 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-primary">
              {scanning
                ? `Scanning — ${scanned.toLocaleString()} of ${status.totalAssets.toLocaleString()} photos done.`
                : `${status.pendingAssets.toLocaleString()} photos have not been scanned for faces yet.`}
            </p>
            <Button
              size="sm"
              variant="primary"
              icon={<ScanFace size={14} />}
              disabled={scanning}
              onClick={() => scan.mutate()}
            >
              {scanning ? 'Scanning…' : 'Scan now'}
            </Button>
          </div>

          {/*
            Only while a scan is actually moving.
            
            Standing outstanding work is not progress — a bar sitting at the
            same fraction for a week says the app is stuck when nothing has been
            asked of it. It appears when the scan is queued and stays until the
            count reaches zero.
          */}
          {scanning && (
            <Progress
              // Indeterminate until the first count comes back, because the
              // queue is still filling and the fraction would jump backwards.
              value={scan.isPending ? undefined : scanned / Math.max(1, status.totalAssets)}
              label="Scanning photos for people and pets"
              className="mt-2.5"
            />
          )}
        </div>
      )}

      {!isLoading && visible.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No people or pets found yet"
          description={
            status?.ready
              ? 'People and pets are grouped as photos are scanned. Once a group has a few photos in it, it shows up here.'
              : 'Once the machine-learning service is running, people and pets in your photos are grouped here automatically.'
          }
          action={
            status?.ready && status.pendingAssets > 0 ? (
              <Button
                variant="primary"
                icon={<ScanFace size={15} />}
                disabled={scanning}
                onClick={() => scan.mutate()}
              >
                {scanning ? 'Scanning…' : 'Scan photos'}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 px-5 pb-24 pt-4 [grid-template-columns:repeat(auto-fill,minmax(124px,1fr))]">
          {visible.map((person) => {
            const isSelected = selected.has(person.id);

            return (
              <div
                key={person.id}
                className="group relative"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ person, anchor: { x: event.clientX, y: event.clientY } });
                }}
              >
                <Link
                  to={selecting ? '#' : `/people/${person.id}`}
                  onClick={(event) => {
                    if (selecting) {
                      event.preventDefault();
                      toggle(person);
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
                    {person.thumbnailPath ? (
                      <img
                        src={`/api/people/${person.id}/thumbnail.jpg`}
                        alt={person.name || `Unnamed ${person.kind === 'PET' ? 'pet' : 'person'}`}
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
                    clicking the face opens the person. */}
                {editingId === person.id ? (
                  <Input
                    autoFocus
                    defaultValue={person.name}
                    placeholder="Add a name"
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') {
                        // Put the old value back so the blur below saves nothing new.
                        event.currentTarget.value = person.name;
                        event.currentTarget.blur();
                      }
                    }}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim();
                      setEditingId(null);
                      if (name !== person.name) rename.mutate({ id: person.id, name });
                    }}
                    // `focus:outline-none` because the primary border already
                    // shows focus; without it the global focus ring sits
                    // outside the border and reads as a second box.
                    size="sm"
                    containerClassName="mt-2 w-full"
                    className="border-primary text-center font-medium focus:outline-none"
                  />
                ) : (
                  <Tooltip label={person.name ? 'Click to rename' : 'Click to add a name'}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selecting) toggle(person);
                      else setEditingId(person.id);
                    }}
                    // A transparent border of the same width as the input's, so
                    // swapping one for the other does not change the height and
                    // shove the cards below it around.
                    className="mt-2 block w-full truncate rounded-control border border-transparent px-1.5 py-0.5 text-center text-sm font-medium transition hover:bg-surface-sunken"
                  >
                    {person.name || <span className="text-content-muted">Add a name</span>}
                  </button>
                  </Tooltip>
                )}

                <span className="block text-center text-[11px] text-content-muted">
                  {person.species ? `${person.species} · ` : ''}
                  {person.faceCount} {person.faceCount === 1 ? 'photo' : 'photos'}
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
        description="Every photo moves into the one group. This cannot be undone automatically, though you can split faces out again afterwards."
        confirmLabel="Merge"
        onConfirm={() => {
          if (!target) return;
          merge.mutate({ targetId: target.id, sourceIds: mergeSources.map((p) => p.id) });
        }}
        onClose={() => setConfirmMerge(false)}
      />

      <ConfirmDialog
        open={Boolean(confirmForget)}
        title={`Remove ${
          confirmForget?.name || (confirmForget?.kind === 'PET' ? 'this pet' : 'this person')
        }?`}
        description="The grouping is discarded, but every photo stays exactly where it is. The faces may be regrouped the next time faces are scanned."
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
              label: menu.person.name ? 'Rename' : 'Add a name',
              icon: <Pencil size={15} />,
              onSelect: () => setEditingId(menu.person.id),
            },
            {
              id: 'merge',
              // The main entry point for merging. The header button was easy to
              // miss, and starting from the person you right-clicked is a far
              // more natural way in than "enter a mode, then pick two".
              label: 'Merge with…',
              icon: <Merge size={15} />,
              hint: 'Then pick who they are the same as',
              onSelect: () => {
                setSelecting(true);
                setSelected(new Set([menu.person.id]));
              },
            },
            {
              id: 'favorite',
              label: menu.person.isFavorite ? 'Remove from favourites' : 'Add to favourites',
              icon: <Star size={15} />,
              onSelect: () =>
                setFavorite.mutate({
                  id: menu.person.id,
                  isFavorite: !menu.person.isFavorite,
                }),
            },
            {
              id: 'kind',
              label: menu.person.kind === 'PET' ? 'This is a person' : 'This is a pet',
              icon:
                menu.person.kind === 'PET' ? <UserRound size={15} /> : <PawPrint size={15} />,
              hint: menu.person.kind === 'PET' ? 'Move to People' : 'Move to Pets',
              onSelect: () =>
                reclassify.mutate({
                  id: menu.person.id,
                  kind: menu.person.kind === 'PET' ? 'PERSON' : 'PET',
                }),
            },
            {
              id: 'hide',
              label: menu.person.isHidden ? 'Show again' : 'Hide from People & Pets',
              icon: menu.person.isHidden ? <Eye size={15} /> : <EyeOff size={15} />,
              separated: true,
              onSelect: () =>
                setHidden.mutate({ id: menu.person.id, isHidden: !menu.person.isHidden }),
            },
            {
              id: 'forget',
              label: menu.person.kind === 'PET' ? 'Remove this pet' : 'Remove this person',
              icon: <Trash2 size={15} />,
              hint: 'The photos are kept',
              danger: true,
              onSelect: () => setConfirmForget(menu.person),
            },
          ]}
        />
      )}
    </div>
  );
}
