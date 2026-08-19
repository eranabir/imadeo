import { useQuery } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Progress } from '../ui';

interface ProcessingStatus {
  total: number;
  ready: number;
  pending: number;
  progressTotal: number;
  progressReady: number;
  previewsPending: number;
  videosPending: number;
}

export function MediaProcessingProgress({
  kind,
  id,
}: {
  kind: 'folder' | 'album';
  id: string;
}) {
  const collection = kind === 'folder' ? 'folders' : 'albums';
  const { data } = useQuery({
    queryKey: [collection, id, 'processing-status'],
    queryFn: async () =>
      (await api.get<ProcessingStatus>(`/${collection}/${id}/processing-status`)).data,
    refetchInterval: (query) => {
      const status = query.state.data;
      return status && status.pending > 0 ? 2_500 : false;
    },
  });

  if (!data || data.total === 0 || data.pending === 0) return null;

  const progress = data.progressTotal > 0 ? data.progressReady / data.progressTotal : 0;
  const percent = Math.floor(progress * 100);
  const label = `${data.ready.toLocaleString()} of ${data.total.toLocaleString()} files ready`;
  const remaining = [
    data.previewsPending > 0
      ? `${data.previewsPending.toLocaleString()} ${data.previewsPending === 1 ? 'preview' : 'previews'}`
      : null,
    data.videosPending > 0
      ? `${data.videosPending.toLocaleString()} ${data.videosPending === 1 ? 'video' : 'videos'}`
      : null,
  ].filter(Boolean).join(' · ');

  return (
    <section
      aria-live="polite"
      className="mx-5 mt-4 rounded-panel border border-border-subtle bg-surface-raised px-4 py-3 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          <LoaderCircle size={18} className="animate-spin" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <strong className="text-sm font-semibold">Preparing media</strong>
            <span className="shrink-0 text-xs tabular-nums text-content-muted">{percent}%</span>
          </span>
          <p className="mt-0.5 text-xs tabular-nums text-content-muted">
            {label} · {remaining} remaining
          </p>
          <Progress value={progress} label={`${percent}% media processing complete`} className="mt-2.5" />
          <p className="mt-2 text-[11px] text-content-muted">
            Your originals are already backed up. Imadeo is creating previews and preparing videos in the background.
          </p>
        </span>
      </div>
    </section>
  );
}
