import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  ALL_QUEUES,
  AssetJobData,
  DEFAULT_JOB_OPTIONS,
  FACE_DETECTION_JOB_OPTIONS,
  JOB,
  QUEUE,
  type QueueName,
} from './job.constants';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);
  private readonly queues: Record<string, Queue>;

  constructor(
    @InjectQueue(QUEUE.METADATA) metadata: Queue,
    @InjectQueue(QUEUE.THUMBNAIL) thumbnail: Queue,
    @InjectQueue(QUEUE.VIDEO) video: Queue,
    @InjectQueue(QUEUE.SMART_SEARCH) smartSearch: Queue,
    @InjectQueue(QUEUE.FACE_DETECTION) faceDetection: Queue,
    @InjectQueue(QUEUE.FACE_CLUSTER) faceCluster: Queue,
    @InjectQueue(QUEUE.DUPLICATE) duplicate: Queue,
    @InjectQueue(QUEUE.STORAGE_MIGRATION) storage: Queue,
    @InjectQueue(QUEUE.MAINTENANCE) maintenance: Queue,
  ) {
    this.queues = {
      [QUEUE.METADATA]: metadata,
      [QUEUE.THUMBNAIL]: thumbnail,
      [QUEUE.VIDEO]: video,
      [QUEUE.SMART_SEARCH]: smartSearch,
      [QUEUE.FACE_DETECTION]: faceDetection,
      [QUEUE.FACE_CLUSTER]: faceCluster,
      [QUEUE.DUPLICATE]: duplicate,
      [QUEUE.STORAGE_MIGRATION]: storage,
      [QUEUE.MAINTENANCE]: maintenance,
    };
  }

  /**
   * Whether Redis is actually answering.
   *
   * Asked through a queue's own connection rather than a new client, so this
   * reports on the connection the jobs really use — a second client could be
   * healthy while the pooled one is wedged. Redis speaks its own protocol, so
   * nothing outside the server can check it directly; this is how `/health`
   * knows, and how the services dashboard knows.
   */
  async isRedisReachable(): Promise<boolean> {
    try {
      // `waitUntilReady` never gives up on its own — ioredis reconnects
      // forever — so a health check has to impose its own deadline or it
      // becomes the slowest thing on the page it is reporting to.
      await Promise.race([
        this.queues[QUEUE.METADATA].waitUntilReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      const connection = await this.queues[QUEUE.METADATA].client;
      return connection.status === 'ready';
    } catch {
      return false;
    }
  }

  /**
   * Kicks off the whole pipeline for a freshly uploaded asset. Only metadata is
   * queued directly — each stage enqueues the next once it has what it needs,
   * so a thumbnail is never attempted before the file's real orientation and
   * capture date are known.
   */
  async onAssetUploaded(assetId: string) {
    await this.enqueue(QUEUE.METADATA, JOB.EXTRACT_METADATA, { assetId });
  }

  /**
   * Re-queuing the same asset for the same stage is a no-op rather than
   * duplicated work, because jobs are keyed on stage + asset.
   *
   * BullMQ reserves `:` in custom job ids (it namespaces its own Redis keys with
   * it), so the two halves are joined with `--`.
   */
  private static jobIdFor(name: string, assetId: string) {
    return `${name}--${assetId}`;
  }

  private optionsFor(queue: QueueName) {
    return queue === QUEUE.FACE_DETECTION ? FACE_DETECTION_JOB_OPTIONS : DEFAULT_JOB_OPTIONS;
  }

  enqueue(queue: QueueName, name: string, data: AssetJobData | Record<string, unknown>, priority?: number) {
    return this.queues[queue].add(name, data, {
      ...this.optionsFor(queue),
      priority,
      jobId:
        'assetId' in data ? JobService.jobIdFor(name, (data as AssetJobData).assetId) : undefined,
    });
  }

  /**
   * Clears failed jobs so a retry is possible.
   *
   * Job ids are keyed on stage + asset to stop duplicate work, but that has a
   * sharp edge: once a job has failed, its id is taken, and re-queuing the same
   * asset is silently ignored. A transient outage — the ML container still
   * loading its models, say — would otherwise mean those assets could never be
   * processed again without wiping Redis by hand.
   */
  async releaseJobIds(queue: QueueName, name: string, assetIds: string[]) {
    const target = this.queues[queue];
    let removed = 0;

    await Promise.all(
      assetIds.map(async (assetId) => {
        const job = await target.getJob(JobService.jobIdFor(name, assetId));
        if (!job) return;

        const state = await job.getState();
        if (state === 'failed' || state === 'completed') {
          await job.remove();
          removed++;
        }
      }),
    );

    return removed;
  }

  async enqueueMany(queue: QueueName, name: string, items: AssetJobData[]) {
    if (items.length === 0) return;
    await this.queues[queue].addBulk(
      items.map((data) => ({
        name,
        data,
        opts: { ...this.optionsFor(queue), jobId: JobService.jobIdFor(name, data.assetId) },
      })),
    );
  }

  /** Queue depth for progress reporting and the admin job dashboard. */
  async getQueueStatistics(name: QueueName) {
    const queue = this.queues[name];
    const counts = await queue.getJobCounts(
      'active',
      'waiting',
      'delayed',
      'failed',
      'completed',
      'paused',
    );
    return {
      active: counts.active ?? 0,
      waiting: counts.waiting ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
      paused: counts.paused ?? 0,
      isPaused: await queue.isPaused(),
    };
  }

  async getStatistics() {
    const entries = await Promise.all(
      ALL_QUEUES.map(async (name) => {
        return [name, await this.getQueueStatistics(name)] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  async pause(queue: QueueName) {
    await this.queues[queue].pause();
  }

  async resume(queue: QueueName) {
    await this.queues[queue].resume();
  }

  async clearFailed(queue: QueueName) {
    const failed = await this.queues[queue].getFailed();
    await Promise.all(failed.map((job) => job.remove()));
    return { cleared: failed.length };
  }

  async retryFailed(queue: QueueName) {
    const failed = await this.queues[queue].getFailed();
    await Promise.all(failed.map((job) => job.retry()));
    return { retried: failed.length };
  }
}
