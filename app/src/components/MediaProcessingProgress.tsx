import { useQuery } from '@tanstack/react-query';
import { Clock3, LoaderCircle, Upload } from 'lucide-react';
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

export interface ProcessingSchedulerStatus {
  workerOnline: boolean;
  mode: 'uploading' | 'interactive' | 'idle';
  activeUploads: number;
  media: { active: number; waiting: number; limit: number };
  heavy: { active: number };
}

export function mediaProcessingState(scheduler?: ProcessingSchedulerStatus) {
  if (scheduler?.workerOnline === false) {
    return {
      title: 'Processing worker is offline',
      description: 'Your originals are safe. Preparation will resume automatically when the worker returns.',
      icon: 'waiting' as const,
    };
  }
  if (scheduler?.mode === 'uploading') {
    return {
      title: 'Waiting for uploads to finish',
      description: 'Media preparation starts after every upload is stored and the server is quiet.',
      icon: 'upload' as const,
    };
  }
  if (scheduler?.mode === 'interactive' && scheduler.media.limit === 0) {
    return {
      title: 'Waiting until Imadeo is idle',
      description: 'Media preparation resumes after you stop interacting with the app.',
      icon: 'waiting' as const,
    };
  }
  if ((scheduler?.media.active ?? 0) === 0 && (scheduler?.heavy.active ?? 0) === 0) {
    return {
      title: 'Media queued',
      description: 'The originals are safe. Preparation will start when the server is idle.',
      icon: 'waiting' as const,
    };
  }
  return {
    title: 'Preparing media',
    description: 'Your originals are safe. Imadeo is creating previews and preparing videos.',
    icon: 'processing' as const,
  };
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
  const { data: scheduler } = useQuery({
    queryKey: ['processing', 'status'],
    queryFn: async () =>
      (await api.get<ProcessingSchedulerStatus>('/processing/status')).data,
    enabled: Boolean(data?.pending),
    refetchInterval: 2_500,
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
  const state = mediaProcessingState(scheduler);

  return (
    <section
      aria-live="polite"
      className="mx-5 mt-4 rounded-panel border border-border-subtle bg-surface-raised px-4 py-3 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
          {state.icon === 'processing' ? (
            <LoaderCircle size={18} className="animate-spin" />
          ) : state.icon === 'upload' ? (
            <Upload size={18} />
          ) : (
            <Clock3 size={18} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <strong className="text-sm font-semibold">{state.title}</strong>
            <span className="shrink-0 text-xs tabular-nums text-content-muted">{percent}%</span>
          </span>
          <p className="mt-0.5 text-xs tabular-nums text-content-muted">
            {label} · {remaining} remaining
          </p>
          <Progress value={progress} label={`${percent}% media processing complete`} className="mt-2.5" />
          <p className="mt-2 text-[11px] text-content-muted">
            {state.description}
          </p>
        </span>
      </div>
    </section>
  );
}
