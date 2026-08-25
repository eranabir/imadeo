/**
 * One queue per pipeline stage. They are separate rather than one queue with a
 * job type so that a backlog of slow video transcodes cannot starve thumbnail
 * generation, and each can carry its own concurrency.
 */
export const QUEUE = {
  METADATA: 'metadata',
  THUMBNAIL: 'thumbnail',
  VIDEO: 'video-transcode',
  SMART_SEARCH: 'smart-search',
  FACE_DETECTION: 'face-detection',
  FACE_CLUSTER: 'face-cluster',
  DUPLICATE: 'duplicate-detection',
  STORAGE_MIGRATION: 'storage-migration',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUE);

/** Queues whose active jobs point at one concrete photo or video. */
export const ASSET_PROCESSING_QUEUES: QueueName[] = [
  QUEUE.METADATA,
  QUEUE.THUMBNAIL,
  QUEUE.VIDEO,
  QUEUE.SMART_SEARCH,
  QUEUE.FACE_DETECTION,
  QUEUE.DUPLICATE,
];

const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Worker decorators run before Nest configuration is created, so read this limit once here. */
export const ML_JOB_CONCURRENCY = positiveInteger(process.env.JOB_ML_CONCURRENCY, 1);

/**
 * The HTTP process registers queue providers so controllers can enqueue and
 * inspect jobs, but it must never execute CPU or disk-heavy processors. The
 * dedicated worker process sets IMADEO_ROLE=worker before loading this module.
 * Keeping the default enabled preserves direct `yarn workspace ... dev` use.
 */
export const PROCESSORS_AUTORUN = process.env.IMADEO_ROLE !== 'api';

export const JOB = {
  EXTRACT_METADATA: 'extract-metadata',
  /// Names the place of a photo that already has coordinates. Its own job so a
  /// backfill of thousands can be queued without re-reading every file's EXIF.
  REVERSE_GEOCODE: 'reverse-geocode',
  GENERATE_THUMBNAILS: 'generate-thumbnails',
  TRANSCODE_VIDEO: 'transcode-video',
  ENCODE_CLIP: 'encode-clip',
  DETECT_FACES: 'detect-faces',
  CLUSTER_FACES: 'cluster-faces',
  DETECT_DUPLICATES: 'detect-duplicates',
  MOVE_ASSET: 'move-asset',
  EMPTY_TRASH: 'empty-trash',
  CLEAN_ORPHANS: 'clean-orphans',
  DELETE_USER: 'delete-user',
} as const;

export interface AssetJobData {
  assetId: string;
  /** Set when the caller already knows the file moved, to skip a lookup. */
  path?: string;
}

export interface UserJobData {
  userId: string;
}

/** Shared retry policy: fail fast on programming errors, ride out flaky IO. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1_000 },
  removeOnFail: { age: 86_400 * 7 },
};

/**
 * Face and pet models can take several minutes to load, and a busy NAS can
 * briefly apply backpressure. Keep those jobs delayed instead of exhausting
 * the normal retry budget and leaving recognition permanently incomplete.
 */
export const FACE_DETECTION_JOB_OPTIONS = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 10,
};
