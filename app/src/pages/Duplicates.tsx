import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Archive,
  Check,
  CopyCheck,
  EyeOff,
  FolderOpen,
  Images,
  Lock,
  RefreshCw,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { AssetViewer } from '../components/AssetViewer';
import { RetryingImage } from '../components/RetryingImage';
import { api, errorMessage, mediaUrl } from '../lib/api';
import { formatBytes, formatDate } from '../lib/format';
import { runBatchedOperation } from '../lib/operationProgress';
import { useAuth } from '../store/auth';
import type { Asset } from '../types';
import { Button, ConfirmDialog, EmptyState, Loading, Tooltip } from '../ui';

interface DuplicateAsset {
  id: string;
  originalFileName: string;
  fileSizeInByte: string;
  localDateTime: string;
  createdAt: string;
  type: 'IMAGE' | 'VIDEO';
  thumbnailPath: string | null;
  exif: { exifImageWidth: number | null; exifImageHeight: number | null } | null;
  locations: {
    kind: 'folder' | 'album' | 'device' | 'photos' | 'archive' | 'locked' | 'hidden';
    label: string;
  }[];
}

interface DuplicateGroup {
  duplicateId: string;
  kind: 'identical' | 'similar';
  reclaimableBytes: number;
  assets: DuplicateAsset[];
}

function LocationIcon({ kind }: { kind: DuplicateAsset['locations'][number]['kind'] }) {
  const props = { size: 11, className: 'shrink-0' };
  if (kind === 'folder') return <FolderOpen {...props} />;
  if (kind === 'device') return <Smartphone {...props} />;
  if (kind === 'archive') return <Archive {...props} />;
  if (kind === 'locked') return <Lock {...props} />;
  if (kind === 'hidden') return <EyeOff {...props} />;
  return <Images {...props} />;
}

function locationKindLabel(kind: DuplicateAsset['locations'][number]['kind']) {
  if (kind === 'folder') return 'Folder';
  if (kind === 'album') return 'Album';
  if (kind === 'device') return 'Device';
  return 'Location';
}

/**
 * Duplicate review.
 *
 * Nothing is deleted without being asked. Each group pre-selects everything
 * except the one worth keeping — largest file, which is the best proxy for
 * "least re-compressed" — but every tile can be toggled, because only the
 * person who took the photos knows which copy matters.
 */
export function DuplicatesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [viewing, setViewing] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Per group: the ids the person has chosen to keep. */
  const [keeping, setKeeping] = useState<Record<string, Set<string>>>({});
  const [trashing, setTrashing] = useState<string[] | null>(null);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['assets', 'duplicates'],
    queryFn: async () => (await api.get<DuplicateGroup[]>('/assets/duplicates')).data,
  });

  const afterChange = () => queryClient.invalidateQueries();
  const onError = (e: unknown) => setError(errorMessage(e));

  const scan = useMutation({
    mutationFn: async () => (await api.post('/assets/duplicates/scan')).data,
    onSuccess: afterChange,
    onError,
  });

  const trash = useMutation({
    mutationFn: async (ids: string[]) =>
      runBatchedOperation(
        ids.length === 1 ? 'Moving duplicate to Trash' : `Moving ${ids.length} duplicates to Trash`,
        ids,
        async (batch) => (await api.delete('/assets', { data: { ids: batch } })).data,
      ),
    onSuccess: afterChange,
    onError,
  });

  const resolve = useMutation({
    mutationFn: async (duplicateId: string) =>
      (await api.post(`/assets/duplicates/${duplicateId}/resolve`)).data,
    onSuccess: afterChange,
    onError,
  });

  if (isLoading) return <Loading label="Looking for duplicates…" />;

  // The first asset in each group is the largest, so it is the default keeper.
  const keptIn = (group: DuplicateGroup) =>
    keeping[group.duplicateId] ?? new Set([group.assets[0].id]);

  const toggleKeep = (group: DuplicateGroup, id: string) =>
    setKeeping((current) => {
      const next = new Set(keptIn(group));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [group.duplicateId]: next };
    });

  const totalReclaimable = groups.reduce((sum, g) => sum + g.reclaimableBytes, 0);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle/60 bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Duplicates</h1>
          <span className="text-xs tabular-nums text-content-muted">
            {groups.length === 0
              ? 'nothing to review'
              : `${groups.length} ${groups.length === 1 ? 'group' : 'groups'} · up to ${formatBytes(totalReclaimable)} to reclaim`}
          </span>
        </div>

        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={14} className={scan.isPending ? 'animate-spin' : undefined} />}
          disabled={scan.isPending}
          onClick={() => scan.mutate()}
        >
          {scan.isPending ? 'Scanning…' : 'Scan again'}
        </Button>
      </header>

      {error && (
        <p className="mx-5 mt-4 rounded-control bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={CopyCheck}
          title="No duplicates found"
          description="Imadeo compares the contents of your photos and how they look, not their file names — so a resized or renamed copy would still show up here."
          action={
            <Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => scan.mutate()}>
              Scan the library
            </Button>
          }
        />
      ) : (
        <div className="space-y-4 px-5 py-4">
          <p className="text-xs text-content-muted">
            Matched on file contents and on how the picture looks — never on the file name alone.
            The largest copy of each is kept by default; click a photo to change what stays.
          </p>

          {groups.map((group) => {
            const kept = keptIn(group);
            const removing = group.assets.filter((a) => !kept.has(a.id));

            return (
              <section
                key={group.duplicateId}
                className="rounded-panel border border-border-subtle bg-surface-raised p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        group.kind === 'identical'
                          ? 'bg-danger-soft text-danger'
                          : 'bg-primary-soft text-primary',
                      )}
                    >
                      {group.kind === 'identical' ? 'Identical files' : 'Looks the same'}
                    </span>
                    <span className="text-xs text-content-muted">
                      {group.assets.length} copies ·{' '}
                      {group.kind === 'identical'
                        ? 'byte for byte the same'
                        : 'resized or re-saved version'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate(group.duplicateId)}
                    >
                      Keep all
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Trash2 size={14} />}
                      disabled={removing.length === 0 || trash.isPending}
                      onClick={() => setTrashing(removing.map((a) => a.id))}
                    >
                      Trash {removing.length}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  {group.assets.map((asset) => {
                    const keep = kept.has(asset.id);
                    const dimensions =
                      asset.exif?.exifImageWidth && asset.exif?.exifImageHeight
                        ? `${asset.exif.exifImageWidth}×${asset.exif.exifImageHeight}`
                        : null;

                    return (
                      <div key={asset.id} className="w-44">
                        <button
                          type="button"
                          onClick={() => toggleKeep(group, asset.id)}
                          className={clsx(
                            'relative block h-32 w-full overflow-hidden rounded-control border-2 transition',
                            keep
                              ? 'border-success'
                              : 'border-transparent opacity-55 hover:opacity-80',
                          )}
                        >
                          <RetryingImage
                            src={mediaUrl(asset.id, 'thumbnail')}
                            assetId={asset.id}
                            thumbnailReady={Boolean(asset.thumbnailPath)}
                            alt={asset.originalFileName}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          <span
                            className={clsx(
                              'absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full text-white',
                              keep ? 'bg-success' : 'bg-black/45',
                            )}
                          >
                            {keep && <Check size={12} strokeWidth={3} />}
                          </span>
                        </button>

                        <p className="mt-1.5 truncate text-[11px] font-medium" title={asset.originalFileName}>
                          {asset.originalFileName}
                        </p>
                        <p className="text-[11px] tabular-nums text-content-muted">
                          {formatBytes(Number(asset.fileSizeInByte))}
                          {dimensions && ` · ${dimensions}`}
                        </p>
                        <p className="text-[11px] text-content-muted">
                          {formatDate(asset.localDateTime, user?.preferences.locale)}
                        </p>

                        <div className="mt-1 space-y-1">
                          {asset.locations.map((location) => (
                            <span
                              key={`${location.kind}:${location.label}`}
                              className="flex items-start gap-1 text-[11px] leading-tight text-content-muted"
                            >
                              <span className="mt-px">
                                <LocationIcon kind={location.kind} />
                              </span>
                              <span className="break-words">
                                <span className="font-medium text-content-secondary">
                                  {locationKindLabel(location.kind)}
                                </span>{' '}
                                · {location.label}
                              </span>
                            </span>
                          ))}
                        </div>

                        <div className="mt-1 flex items-center gap-1.5">
                          <Tooltip label="Open this copy">
                            <button
                              type="button"
                              onClick={() => setViewing(asset as unknown as Asset)}
                              className="text-[11px] font-medium text-primary hover:underline"
                            >
                              View
                            </button>
                          </Tooltip>
                          {keep && (
                            <span className="flex items-center gap-1 text-[11px] font-medium text-success">
                              <Sparkles size={10} />
                              keeping
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {viewing && (
        <AssetViewer
          asset={viewing}
          assets={[viewing]}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}
      <ConfirmDialog
        open={trashing !== null}
        title={`Move ${trashing?.length ?? 0} duplicate ${(trashing?.length ?? 0) === 1 ? 'photo' : 'photos'} to trash?`}
        description={trashing?.length === 1 ? 'You can restore it from Trash for 30 days.' : 'You can restore them from Trash for 30 days.'}
        confirmLabel="Move to trash"
        destructive
        onConfirm={() => trashing && trash.mutate(trashing)}
        onClose={() => setTrashing(null)}
      />
    </div>
  );
}
