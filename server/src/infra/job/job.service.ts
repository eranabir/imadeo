import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  ALL_QUEUES,
  ASSET_PROCESSING_QUEUES,
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
  private static jobIdFor(name: string, targetId: string) {
    return `${name}--${targetId}`;
  }

  private optionsFor(queue: QueueName) {
    return queue === QUEUE.FACE_DETECTION ? FACE_DETECTION_JOB_OPTIONS : DEFAULT_JOB_OPTIONS;
  }

  enqueue(queue: QueueName, name: string, data: AssetJobData | Record<string, unknown>, priority?: number) {
    return this.queues[queue].add(name, data, {
      ...this.optionsFor(queue),
      priority,
      jobId:
        'assetId' in data
          ? JobService.jobIdFor(name, (data as AssetJobData).assetId)
          : 'userId' in data && typeof data.userId === 'string'
            ? JobService.jobIdFor(name, data.userId)
            : undefined,
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

  /**
   * Removes redundant queued copies of one asset stage after a coalesced job
   * completed the work for the whole owner. The currently active job keeps its
   * lock and is deliberately left for BullMQ to finish normally.
   */
  async removeQueuedAssetJobs(queue: QueueName, name: string, assetIds: string[]) {
    const target = this.queues[queue];
    let removed = 0;

    for (let index = 0; index < assetIds.length; index += 100) {
      const batch = assetIds.slice(index, index + 100);
      await Promise.all(batch.map(async (assetId) => {
        const job = await target.getJob(JobService.jobIdFor(name, assetId));
        if (!job || (await job.getState()) === 'active') return;

        try {
          await job.remove();
          removed++;
        } catch (error) {
          this.logger.debug(
            `Asset job ${job.id ?? `${name}/${assetId}`} became active before coalescing: ${String(error)}`,
          );
        }
      }));
    }

    return removed;
  }

  /**
   * Removes every queued processing stage for assets that entered Trash.
   *
   * BullMQ cannot remove a job while a worker owns its lock, so active jobs are
   * left for the processor's deleted-asset guard. Waiting, delayed, failed and
   * completed jobs are removed so they cannot run later or reserve their job id
   * when the asset is restored.
   */
  async cancelAssetProcessing(assetIds: string[]) {
    const stages: [QueueName, string][] = [
      [QUEUE.METADATA, JOB.EXTRACT_METADATA],
      [QUEUE.METADATA, JOB.REVERSE_GEOCODE],
      [QUEUE.THUMBNAIL, JOB.GENERATE_THUMBNAILS],
      [QUEUE.VIDEO, JOB.GENERATE_THUMBNAILS],
      [QUEUE.VIDEO, JOB.TRANSCODE_VIDEO],
      [QUEUE.SMART_SEARCH, JOB.ENCODE_CLIP],
      [QUEUE.FACE_DETECTION, JOB.DETECT_FACES],
      [QUEUE.DUPLICATE, JOB.DETECT_DUPLICATES],
    ];
    let removed = 0;

    // A folder can contain tens of thousands of files. Bound Redis fan-out so
    // deleting it does not become another source of API pressure.
    const uniqueIds = [...new Set(assetIds)];
    for (const [queue, name] of stages) {
      for (let index = 0; index < uniqueIds.length; index += 100) {
        const batch = uniqueIds.slice(index, index + 100);
        await Promise.all(batch.map(async (assetId) => {
          const job = await this.queues[queue].getJob(JobService.jobIdFor(name, assetId));
          if (!job || (await job.getState()) === 'active') return;

          try {
            await job.remove();
            removed++;
          } catch (error) {
            // The worker may have acquired the job between getState and remove.
            this.logger.debug(
              `Asset job ${job.id ?? `${name}/${assetId}`} became active before cancellation: ${String(error)}`,
            );
          }
        }));
      }
    }

    return removed;
  }

  async enqueueMany(queue: QueueName, name: string, items: AssetJobData[], priority?: number) {
    if (items.length === 0) return;
    await this.queues[queue].addBulk(
      items.map((data) => ({
        name,
        data,
        opts: { ...this.optionsFor(queue), priority, jobId: JobService.jobIdFor(name, data.assetId) },
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

  /** Analysis must not compete with metadata, previews, or video transcoding. */
  async waitForMediaProcessingIdle(pollMs = 500) {
    const mediaQueues = [QUEUE.METADATA, QUEUE.THUMBNAIL, QUEUE.VIDEO] as const;
    while (true) {
      const statistics = await Promise.all(
        mediaQueues.map((queue) => this.getQueueStatistics(queue)),
      );
      if (statistics.every(({ active, waiting, delayed }) => active + waiting + delayed === 0)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /**
   * A lightweight operational snapshot for Settings. Only active jobs are
   * expanded into files; queue totals stay aggregated so a large backlog does
   * not turn a monitoring request into another source of server load.
   */
  async getAssetProcessingSnapshot() {
    const queues = await Promise.all(
      ASSET_PROCESSING_QUEUES.map(async (name) => {
        const queue = this.queues[name];
        const [statistics, active] = await Promise.all([
          this.getQueueStatistics(name),
          queue.getActive(0, -1),
        ]);
        return {
          name,
          ...statistics,
          activeJobs: active.flatMap((job) => {
            const assetId =
              job.data && typeof job.data === 'object' && typeof job.data.assetId === 'string'
                ? job.data.assetId
                : null;
            if (!assetId) return [];
            return [{
              id: String(job.id ?? `${name}-${assetId}`),
              queue: name,
              name: job.name,
              assetId,
              progress: job.progress,
              createdAt: new Date(job.timestamp).toISOString(),
              startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
              attemptsMade: job.attemptsMade,
            }];
          }),
        };
      }),
    );

    return {
      queues: queues.map(({ activeJobs: _activeJobs, ...queue }) => queue),
      activeJobs: queues
        .flatMap(({ activeJobs }) => activeJobs)
        .sort((a, b) => (a.startedAt ?? a.createdAt).localeCompare(b.startedAt ?? b.createdAt)),
    };
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
