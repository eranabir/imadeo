import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, EyeOff, Image as ImageIcon, Pencil, UserRound, UserRoundX } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AssetViewer } from '../components/AssetViewer';
import { RetryingImage } from '../components/RetryingImage';
import { JustifiedGrid } from '../components/JustifiedGrid';
import { SelectionBar } from '../components/SelectionBar';
import { useLibraryActions } from '../components/useLibraryActions';
import { api, errorMessage, mediaUrl } from '../lib/api';
import { useSelection } from '../lib/useSelection';
import { useAuth } from '../store/auth';
import type { Asset, Paginated } from '../types';
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Loading,
  Tooltip,
} from '../ui';

interface Subject {
  id: string;
  name: string;
  thumbnailPath: string;
  updatedAt: string;
  isHidden: boolean;
  faceCount: number;
  kind: 'PERSON' | 'PET';
}

/** Carries this subject's detections, so a wrong one can be pointed at. */
interface AssetWithFaces extends Asset {
  faces?: { id: string }[];
}

/** Every photo one subject appears in, with the same tools as any other grid. */
export function SubjectPage() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [viewing, setViewing] = useState<Asset | null>(null);
  const [renaming, setRenaming] = useState(false);
  /** Bumped after picking a cover so the avatar image is refetched. */
  const [coverVersion, setCoverVersion] = useState(0);
  const [choosingCover, setChoosingCover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { selected, toggle, selectRange, setAnchor, clear } = useSelection<Asset>();
  /**
   * The current photos, readable from the context-menu callback. That callback
   * is built before `assets` exists in this render, and runs long afterwards.
   */
  const assetsRef = useRef<AssetWithFaces[]>([]);

  const { data: subject, isLoading } = useQuery({
    queryKey: ['subjects', subjectId],
    queryFn: async () => (await api.get<Subject>(`/people-and-pets/${subjectId}`)).data,
    enabled: Boolean(subjectId),
  });

  /**
   * Which of the two words to use about this subject.
   *
   * "Not this person" on a dog's page is the wrong noun for the thing being
   * said — the tab is called People & Pets, and half of what it holds is not a
   * person.
   */
  const subjectNoun = subject?.kind === 'PET' ? 'pet' : 'person';

  const actions = useLibraryActions({
    onShowDetails: setViewing,
    selectedIds: [...selected],
    // Same correction as the selection bar, reachable straight from a photo
    // without having to select it first.
    extraAssetItems: (asset, ids) => [
      {
        id: 'set-cover',
        label: 'Use as cover',
        icon: <ImageIcon size={15} />,
        hint: 'The picture shown for them everywhere',
        separated: true,
        // Only meaningful for one photo — a cover is a single choice.
        disabled: ids.length > 1,
        onSelect: () => setCover.mutate(asset.id),
      },
      {
        id: 'not-this-subject',
        label: `${subjectNoun === 'pet' ? 'Not this pet' : 'Not this person'}${
          ids.length > 1 ? ` (${ids.length})` : ''
        }`,
        icon: <UserRoundX size={15} />,
        hint: 'Keeps the photo, removes the match',
        separated: true,
        onSelect: () => {
          const faceIds = assetsRef.current
            .filter((entry) => ids.includes(entry.id))
            .flatMap((entry) => entry.faces?.map((face) => face.id) ?? []);
          if (faceIds.length > 0) detach.mutate(faceIds);
        },
      },
    ],
  });

  const { data: photos } = useQuery({
    queryKey: ['subjects', subjectId, 'assets'],
    queryFn: async () =>
      (await api.get<Paginated<AssetWithFaces>>(`/people-and-pets/${subjectId}/assets`)).data,
    enabled: Boolean(subjectId),
  });

  const invalidate = () => queryClient.invalidateQueries();
  const onError = (e: unknown) => setError(errorMessage(e));

  const rename = useMutation({
    mutationFn: async (name: string) =>
      (await api.put(`/people-and-pets/${subjectId}`, { name })).data,
    onSuccess: invalidate,
    onError,
  });

  const hide = useMutation({
    mutationFn: async () =>
      (await api.put(`/people-and-pets/${subjectId}`, { isHidden: true })).data,
    onSuccess: () => {
      void invalidate();
      navigate('/people-and-pets');
    },
    onError,
  });

  const afterBulk = () => {
    clear();
    return invalidate();
  };

  const favorite = useMutation({
    mutationFn: async (ids: string[]) =>
      (await api.put('/assets/bulk', { ids, isFavorite: true })).data,
    onSuccess: afterBulk,
    onError,
  });

  const trash = useMutation({
    mutationFn: async (ids: string[]) => (await api.post('/assets/trash', { ids })).data,
    onSuccess: afterBulk,
    onError,
  });

  const setCover = useMutation({
    mutationFn: async (assetId: string) =>
      (await api.put(`/people-and-pets/${subjectId}/cover`, { assetId })).data,
    // The avatar URL does not change, so the browser would keep showing the old
    // crop; a cache-busting key on the <img> is what actually refreshes it.
    onSuccess: () => {
      setCoverVersion((n) => n + 1);
      return invalidate();
    },
    onError,
  });

  /**
   * Corrects a wrong match: the face stops belonging to this subject, but the
   * photo itself is untouched. The server pins the detection so the next
   * clustering pass does not simply put it back.
   */
  const detach = useMutation({
    mutationFn: async (faceIds: string[]) =>
      (await api.post(`/people-and-pets/${subjectId}/detach`, { faceIds })).data,
    onSuccess: afterBulk,
    onError,
  });

  if (isLoading) return <Loading label="Loading photos…" />;
  if (!subject) return null;

  const assets: AssetWithFaces[] = photos?.items ?? [];
  assetsRef.current = assets;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <nav className="mb-1 flex items-center gap-1 text-xs text-content-muted">
          <Link to="/people-and-pets" className="flex items-center gap-1 transition hover:text-content">
            <ArrowLeft size={12} />
            People &amp; Pets
          </Link>
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* The avatar is the obvious place to go to change the avatar, so
                it is a control rather than decoration. */}
            <Tooltip label="Choose a cover photo">
              <button
                type="button"
                onClick={() => setChoosingCover(true)}
                aria-label="Choose a cover photo"
                className="group relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-sunken"
              >
                {subject.thumbnailPath ? (
                  <img
                    src={`/api/people-and-pets/${subject.id}/thumbnail.jpg?v=${coverVersion || encodeURIComponent(subject.updatedAt)}`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserRound size={18} className="text-content-muted" />
                )}
                <span className="absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition group-hover:opacity-100">
                  <ImageIcon size={14} />
                </span>
              </button>
            </Tooltip>

            <div>
              {/* Same behaviour as the People grid: the name is the control.
                  Clicking it starts typing rather than opening a dialog. */}
              {renaming ? (
                <Input
                  autoFocus
                  defaultValue={subject.name}
                  placeholder="Add a name"
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') {
                      event.currentTarget.value = subject.name;
                      event.currentTarget.blur();
                    }
                  }}
                  onBlur={(event) => {
                    const name = event.currentTarget.value.trim();
                    setRenaming(false);
                    if (name !== subject.name) rename.mutate(name);
                  }}
                  // Matches the button's box exactly — same padding and border
                  // width — so the heading does not jump when it becomes a
                  // field. `focus:outline-none` avoids the global focus ring
                  // drawing a second box outside the primary border.
                  containerClassName="-ml-1.5 w-56"
                  className="border-primary text-lg font-semibold tracking-tight focus:outline-none"
                />
              ) : (
                <Tooltip label={subject.name ? 'Click to rename' : 'Click to add a name'}>
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  className="-ml-1.5 block rounded-control border border-transparent px-1.5 text-lg font-semibold tracking-tight transition hover:bg-surface-sunken"
                >
                  {subject.name || <span className="text-content-muted">Add a name</span>}
                </button>
                </Tooltip>
              )}
              <p className="text-xs text-content-muted">
                {subject.faceCount} {subject.faceCount === 1 ? 'photo' : 'photos'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip label={subject.name ? 'Rename' : 'Add a name'}>
              <IconButton
                label={subject.name ? 'Rename' : 'Add a name'}
                variant="secondary"
                size="sm"
                round={false}
                onClick={() => setRenaming(true)}
              >
                <Pencil size={14} />
              </IconButton>
            </Tooltip>
            <Tooltip label="Hide from People & Pets">
              <IconButton
                label="Hide from People & Pets"
                variant="secondary"
                size="sm"
                round={false}
                onClick={() => hide.mutate()}
              >
                <EyeOff size={14} />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      </header>

      {error && (
        <p className="mx-5 mt-4 rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {assets.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No photos yet"
          description={`Photos of this ${subjectNoun} have not finished processing.`}
          action={
            <Button variant="primary" onClick={() => navigate('/people-and-pets')}>
              Back to People &amp; Pets
            </Button>
          }
        />
      ) : (
        <div className="px-2 pb-24 pt-3">
          <JustifiedGrid
            assets={assets}
            selected={selected}
            targetRowHeight={user?.preferences.tileSize ?? 220}
            onOpen={setViewing}
            onToggleSelect={toggle}
            onSelectRange={(a) => selectRange(a, assets)}
            onAnchor={setAnchor}
            onContextMenu={actions.onAssetContextMenu}
          />
        </div>
      )}

      {actions.overlays}

      <Dialog
        open={choosingCover}
        title="Choose a cover photo"
        description="Pick which of their photos the small round picture is cropped from."
        onClose={() => setChoosingCover(false)}
      >
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => {
                setCover.mutate(asset.id);
                setChoosingCover(false);
              }}
              className="aspect-square overflow-hidden rounded-control border-2 border-transparent transition hover:border-primary"
            >
              <RetryingImage
                src={mediaUrl(asset.id, 'thumbnail')}
                alt={asset.originalFileName}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      </Dialog>

      <SelectionBar
        count={selected.size}
        onClear={clear}
        onFavorite={() => favorite.mutate([...selected])}
        onDownload={() => {
          window.location.href = `/api/assets/download/archive?ids=${[...selected].join(',')}`;
        }}
        onTrash={() => trash.mutate([...selected])}
      >
        <span className="mx-1 h-5 w-px bg-white/15" />
        <Tooltip label={`Remove these photos from this ${subjectNoun}. The photos are kept.`}>
        <button
          type="button"
          disabled={detach.isPending}
          onClick={() => {
            // A photo can contain several subjects; only this subject's detections
            // are sent, so nobody else loses the picture.
            const faceIds = assets
              .filter((asset) => selected.has(asset.id))
              .flatMap((asset) => asset.faces?.map((face) => face.id) ?? []);
            if (faceIds.length > 0) detach.mutate(faceIds);
          }}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
        >
          <UserRoundX size={16} />
          {subjectNoun === 'pet' ? 'Not this pet' : 'Not this person'}
        </button>
        </Tooltip>
      </SelectionBar>

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
