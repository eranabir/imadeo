import { useQuery } from '@tanstack/react-query';
import {
  Clock3,
  FileImage,
  Film,
  Gauge,
  LoaderCircle,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { formatBytes, formatInstant } from '../lib/format';
import { Progress } from '../ui';

interface ActiveProcessingJob {
  id: string;
  queue: string;
  name: string;
  assetId: string;
  progress: unknown;
  createdAt: string;
  startedAt: string | null;
  attemptsMade: number;
  fileName: string;
  mediaType: 'IMAGE' | 'VIDEO' | null;
  fileSizeInByte: string | null;
  owner: string | null;
}

interface ProcessingSnapshot {
  scheduler: {
    workerOnline: boolean;
    mode: 'uploading' | 'interactive' | 'idle';
    activeUploads: number;
    media: { active: number; waiting: number; limit: number };
    heavy: { active: number };
    activeQueues: Record<string, number>;
  };
  activeJobs: ActiveProcessingJob[];
  updatedAt: string;
}

interface RecognitionSnapshot {
  queuedAssets: number;
  processingAssets: number;
  scanPendingAssets: number;
  scanTotalAssets: number;
  scanning: boolean;
}

const QUEUE_LABELS: Record<string, string> = {
  metadata: 'Metadata',
  thumbnail: 'Previews',
  'video-transcode': 'Videos',
  'smart-search': 'Search',
  'face-detection': 'People & Pets',
  'duplicate-detection': 'Duplicates',
};

const JOB_LABELS: Record<string, string> = {
  'extract-metadata': 'Reading metadata',
  'reverse-geocode': 'Finding the place',
  'generate-thumbnails': 'Creating previews',
  'transcode-video': 'Optimising video',
  'encode-clip': 'Indexing for search',
  'detect-faces': 'Scanning People & Pets',
  'detect-duplicates': 'Checking duplicates',
};

const schedulerCopy = (snapshot: ProcessingSnapshot) => {
  if (!snapshot.scheduler.workerOnline) {
    return 'The processing worker is offline. Originals remain safe and queued work will resume when it returns.';
  }
  if (snapshot.scheduler.mode === 'uploading') {
    return 'Uploads have priority. Background processing will continue when storage is quiet.';
  }
  if (snapshot.scheduler.mode === 'interactive') {
    const slots = snapshot.scheduler.media.limit;
    if (slots === 0) return 'The web app is active. Background media preparation will resume when it is idle.';
    return `The web app is active, so processing can use ${slots} background ${slots === 1 ? 'slot' : 'slots'}.`;
  }
  return `The server is idle and can use up to ${snapshot.scheduler.media.limit} background slots.`;
};

export function ProcessingSettings() {
  const query = useQuery({
    queryKey: ['admin', 'processing'],
    queryFn: async () => (await api.get<ProcessingSnapshot>('/admin/processing')).data,
    refetchInterval: 3_000,
  });
  const recognitionQuery = useQuery({
    queryKey: ['subjects', 'status'],
    queryFn: async () =>
      (await api.get<RecognitionSnapshot>('/people-and-pets/status')).data,
    refetchInterval: 3_000,
  });

  const snapshot = query.data;
  const recognition = recognitionQuery.data;
  const activeJobs = snapshot?.activeJobs ?? [];
  const detectedRecognitionJobs = activeJobs.filter((job) => job.name === 'detect-faces').length;
  const recognitionActive = recognition?.processingAssets ?? detectedRecognitionJobs;
  const mediaActive = activeJobs.filter((job) => job.name !== 'detect-faces').length;
  const active = mediaActive + recognitionActive;
  const recognitionVisible = recognitionActive > 0;

  return (
    <div className="space-y-6">
      <section className="rounded-panel border border-border-subtle bg-surface-raised p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
            {active > 0 ? (
              <LoaderCircle size={19} className="animate-spin" />
            ) : (
              <Gauge size={19} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">
                  {active > 0
                    ? `${active} active file ${active === 1 ? 'task' : 'tasks'}`
                    : snapshot?.scheduler.workerOnline === false
                      ? 'Processing worker is offline'
                      : 'Processing is idle'}
                </h2>
                {snapshot && (
                  <p className="mt-1 text-xs text-content-muted">
                    {schedulerCopy(snapshot)}
                  </p>
                )}
              </div>
              {snapshot && (
                <span className="text-[11px] text-content-muted">
                  Updated {new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </div>

            {snapshot && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Summary label="Media processing now" value={mediaActive} />
                <Summary label="Face recognition now" value={recognitionActive} />
              </div>
            )}
          </div>
        </div>

        {query.isLoading && (
          <p className="mt-4 text-sm text-content-muted">Reading current processing…</p>
        )}
        {query.isError && (
          <p className="mt-4 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
            {errorMessage(query.error)}
          </p>
        )}
      </section>

      {snapshot && (
        <section className="rounded-panel border border-border-subtle bg-surface-raised p-5">
          <h2 className="text-sm font-semibold">Currently processing</h2>
          <p className="mt-1 text-xs text-content-muted">Every active task and the file it is working on.</p>

          {recognitionVisible && recognition && (
            <RecognitionProgress recognition={recognition} />
          )}

          {snapshot.activeJobs.length === 0 && !recognitionVisible ? (
            <div className="mt-4 rounded-control bg-surface-sunken px-4 py-5 text-center">
              <Clock3 size={20} className="mx-auto text-content-muted" />
              <p className="mt-2 text-sm font-medium">No files are processing right now</p>
              <p className="mt-1 text-xs text-content-muted">
                Thumbnail creation, video optimisation and recognition are idle.
              </p>
            </div>
          ) : (
            <div className={recognitionVisible ? 'mt-3 divide-y divide-border-subtle' : 'mt-4 divide-y divide-border-subtle'}>
              {snapshot.activeJobs.map((job) => <ActiveJob key={`${job.queue}-${job.id}`} job={job} />)}
            </div>
          )}
        </section>
      )}

      {snapshot && (
        <section className="rounded-panel border border-border-subtle bg-surface-raised p-5">
          <h2 className="text-sm font-semibold">Processing activity</h2>
          <p className="mt-1 text-xs text-content-muted">Only files being worked on right now.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <StageStatus label="Reading media details" active={countJobs(snapshot.activeJobs, ['extract-metadata', 'reverse-geocode'])} />
            <StageStatus label="Creating thumbnails" active={countJobs(snapshot.activeJobs, ['generate-thumbnails'])} />
            <StageStatus label="Optimising videos" active={countJobs(snapshot.activeJobs, ['transcode-video'])} />
            <StageStatus label="Indexing search" active={countJobs(snapshot.activeJobs, ['encode-clip'])} />
            <StageStatus
              label="People & Pets recognition"
              active={recognitionActive}
            />
            <StageStatus label="Checking duplicates" active={countJobs(snapshot.activeJobs, ['detect-duplicates'])} />
          </div>
        </section>
      )}
    </div>
  );
}

function RecognitionProgress({ recognition }: { recognition: RecognitionSnapshot }) {
  const total = recognition.scanTotalAssets;
  const remaining = recognition.scanPendingAssets;
  const done = Math.max(0, total - remaining);
  const value = total > 0 ? done / total : 0;
  const running = recognition.processingAssets > 0;

  return (
    <div className="mt-4 rounded-control border border-border-subtle bg-surface-sunken px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
          {running ? <LoaderCircle size={17} className="animate-spin" /> : <Clock3 size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">People & Pets recognition</p>
            <span className="text-xs font-medium text-primary">
              {running ? 'Scanning now' : 'Waiting to scan'}
            </span>
          </div>
          <p className="mt-1 text-xs tabular-nums text-content-muted">
            {done.toLocaleString()} of {total.toLocaleString()} media scanned · {remaining.toLocaleString()} remaining
          </p>
          <Progress value={value} label={`${Math.round(value * 100)}%`} className="mt-2" />
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-control bg-surface-sunken px-3 py-2">
      <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-[11px] text-content-muted">{label}</p>
    </div>
  );
}

function ActiveJob({ job }: { job: ActiveProcessingJob }) {
  const progress = typeof job.progress === 'number' ? Math.min(100, Math.max(0, job.progress)) : null;
  const MediaIcon = job.mediaType === 'VIDEO' ? Film : FileImage;
  return (
    <div className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
        <MediaIcon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 truncate text-sm font-medium" title={job.fileName}>{job.fileName}</p>
          <span className="shrink-0 text-xs font-medium text-primary">
            {JOB_LABELS[job.name] ?? QUEUE_LABELS[job.queue] ?? job.name}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-content-muted">
          {[job.owner, job.fileSizeInByte ? formatBytes(job.fileSizeInByte) : null, job.startedAt ? `started ${formatInstant(job.startedAt)}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {progress !== null && progress > 0 && (
          <Progress value={progress / 100} label={`${progress}%`} className="mt-2" />
        )}
      </div>
    </div>
  );
}

function countJobs(jobs: ActiveProcessingJob[], names: string[]) {
  return jobs.filter((job) => names.includes(job.name)).length;
}

function StageStatus({
  label,
  active,
  waiting = 0,
}: {
  label: string;
  active: number;
  waiting?: number;
}) {
  return (
    <div className="rounded-control border border-border-subtle bg-surface-sunken px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {active > 0 && <LoaderCircle size={14} className="animate-spin text-primary" />}
      </div>
      <p className="mt-1 text-xs tabular-nums text-content-muted">
        {active > 0
          ? `${active.toLocaleString()} ${active === 1 ? 'file' : 'files'} processing now${waiting > active ? ` · ${waiting.toLocaleString()} remaining` : ''}`
          : waiting > 0
            ? `${waiting.toLocaleString()} ${waiting === 1 ? 'file' : 'files'} waiting to scan`
          : 'Not running'}
      </p>
    </div>
  );
}
