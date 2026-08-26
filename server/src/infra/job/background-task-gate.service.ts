import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { QUEUE } from './job.constants';
import {
  ProcessingSignalService,
  type ProcessingSchedulerStatus,
} from './processing-signal.service';

/**
 * Keeps user requests responsive without stopping the processing pipeline.
 *
 * A short grace period keeps the gate closed between consecutive file requests,
 * so a browser sending four files at a time does not restart ML in every gap.
 * Uploads pause all derivative work. Active browsing pauses it by default,
 * while an idle application expands to the configured concurrency.
 * CPU-heavy work runs only after media work and real interaction are quiet.
 */
@Injectable()
export class BackgroundTaskGate implements OnModuleDestroy {
  private static readonly HEAVY_QUEUE_PRIORITY: string[] = [
    QUEUE.VIDEO,
    QUEUE.FACE_DETECTION,
    QUEUE.FACE_CLUSTER,
    QUEUE.SMART_SEARCH,
    QUEUE.DUPLICATE,
  ];
  private readonly uploadIdleMs: number;
  private readonly userIdleMs: number;
  private readonly processingConcurrency: number;
  private readonly activeUserConcurrency: number;
  private readonly stateWaiters = new Set<() => void>();
  private activeUploads = 0;
  private activeProcessing = 0;
  private waitingProcessing = 0;
  private activeHeavyProcessing = 0;
  private readonly waitingHeavyQueues = new Map<string, number>();
  private readonly activeQueues = new Map<string, number>();
  private idleTimer: NodeJS.Timeout | null = null;
  private userIdleTimer: NodeJS.Timeout | null = null;
  private statusHeartbeat: NodeJS.Timeout | null = null;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly signals: ProcessingSignalService,
  ) {
    this.uploadIdleMs = Math.max(0, config.get('jobs.uploadIdleMs', { infer: true }));
    this.userIdleMs = Math.max(0, config.get('jobs.userIdleMs', { infer: true }));
    this.processingConcurrency = Math.max(
      1,
      config.get('jobs.processingConcurrency', { infer: true }),
    );
    this.activeUserConcurrency = Math.min(
      this.processingConcurrency,
      Math.max(0, config.get('jobs.activeUserConcurrency', { infer: true })),
    );
    if (process.env.IMADEO_ROLE !== 'api') {
      this.statusHeartbeat = setInterval(
        () => this.publishStatus(),
        5_000,
      ) as unknown as NodeJS.Timeout;
      this.statusHeartbeat.unref();
      this.publishStatus();
    }
  }

  /**
   * Extends the quiet window after a real browser interaction. The client
   * throttles these signals, so background polling does not starve the queues.
   */
  noteUserActivity() {
    this.signals.noteUserActivity();
    if (this.userIdleMs === 0) return;
    if (this.userIdleTimer) clearTimeout(this.userIdleTimer);
    const timer = setTimeout(
      () => this.finishUserIdlePeriod(),
      this.userIdleMs,
    ) as unknown as NodeJS.Timeout;
    timer.unref();
    this.userIdleTimer = timer;
  }

  /** Starts an upload-priority window and returns an idempotent completion callback. */
  beginUpload() {
    const finishSharedUpload = this.signals.beginUpload();
    this.activeUploads += 1;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      finishSharedUpload();
      this.activeUploads = Math.max(0, this.activeUploads - 1);
      if (this.activeUploads > 0) return;

      if (this.uploadIdleMs === 0) {
        this.notifyStateChange();
        return;
      }
      const timer = setTimeout(
        () => this.finishUploadIdlePeriod(),
        this.uploadIdleMs,
      ) as unknown as NodeJS.Timeout;
      timer.unref();
      this.idleTimer = timer;
    };
  }

  /**
   * Runs file metadata and thumbnail work in the shared media lane. Browsing
   * can reduce its concurrency to zero so foreground work stays responsive.
   */
  async runMediaProcessing<T>(operation: () => Promise<T>, queue?: string): Promise<T> {
    this.waitingProcessing += 1;
    this.publishStatus();
    try {
      while (true) {
        await this.signals.waitForBackgroundWindow();
        while (!this.canStartMediaProcessing()) await this.waitForStateChange();
        if (await this.signals.backgroundWindowIsOpen()) break;
      }
      this.activeProcessing += 1;
      this.markQueueStarted(queue);
    } finally {
      this.waitingProcessing = Math.max(0, this.waitingProcessing - 1);
      this.publishStatus();
    }

    try {
      return await operation();
    } finally {
      this.activeProcessing = Math.max(0, this.activeProcessing - 1);
      this.markQueueFinished(queue);
      this.notifyStateChange();
    }
  }

  /** Backwards-compatible name used by the thumbnail processor. */
  runThumbnail<T>(operation: () => Promise<T>, queue?: string): Promise<T> {
    return this.runMediaProcessing(operation, queue);
  }

  /** Runs transcoding, duplicate scans and inference only during quiet periods. */
  async runHeavyProcessing<T>(operation: () => Promise<T>, queue?: string): Promise<T> {
    this.markHeavyQueueWaiting(queue, 1);
    this.publishStatus();
    try {
      while (true) {
        await this.signals.waitForBackgroundWindow();
        while (!this.canStartHeavyProcessing(queue)) await this.waitForStateChange();
        if (await this.signals.backgroundWindowIsOpen()) break;
      }
      this.activeHeavyProcessing += 1;
      this.markQueueStarted(queue);
    } finally {
      this.markHeavyQueueWaiting(queue, -1);
      this.publishStatus();
    }

    try {
      return await operation();
    } finally {
      this.activeHeavyProcessing = Math.max(0, this.activeHeavyProcessing - 1);
      this.markQueueFinished(queue);
      this.notifyStateChange();
    }
  }

  /** Backwards-compatible semantic name used by ML processors. */
  runMachineLearning<T>(operation: () => Promise<T>, queue?: string): Promise<T> {
    return this.runHeavyProcessing(operation, queue);
  }

  /** Current scheduler state for the administrator Processing page. */
  getStatus(): ProcessingSchedulerStatus {
    const uploadPriority = this.activeUploads > 0 || Boolean(this.idleTimer);
    const mode = uploadPriority ? 'uploading' : this.userIdleTimer ? 'interactive' : 'idle';
    return {
      workerOnline: process.env.IMADEO_ROLE !== 'api',
      mode,
      activeUploads: this.activeUploads,
      media: {
        active: this.activeProcessing,
        waiting: this.waitingProcessing,
        limit: uploadPriority
          ? 0
          : this.userIdleTimer
            ? this.activeUserConcurrency
            : this.processingConcurrency,
      },
      heavy: { active: this.activeHeavyProcessing },
      activeQueues: Object.fromEntries(this.activeQueues),
    };
  }

  /** The API reports the dedicated worker's state, not its own disabled processors. */
  async getSharedStatus(): Promise<ProcessingSchedulerStatus> {
    const shared =
      process.env.IMADEO_ROLE === 'api' ? await this.signals.readWorkerStatus() : null;
    const status = shared ?? { ...this.getStatus(), workerOnline: process.env.IMADEO_ROLE !== 'api' };
    const activeUploads = Math.max(
      this.activeUploads,
      status.activeUploads,
      await this.signals.activeUploadCount(),
    );
    const uploadPriority = activeUploads > 0 || Boolean(this.idleTimer);
    if (!uploadPriority) {
      if (!this.userIdleTimer && !(await this.signals.userIsActive())) return status;
      return {
        ...status,
        mode: 'interactive',
        media: { ...status.media, limit: this.activeUserConcurrency },
      };
    }
    return {
      ...status,
      mode: 'uploading',
      activeUploads,
      media: { ...status.media, limit: 0 },
    };
  }

  onModuleDestroy() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.userIdleTimer) clearTimeout(this.userIdleTimer);
    if (this.statusHeartbeat) clearInterval(this.statusHeartbeat);
    this.idleTimer = null;
    this.userIdleTimer = null;
    this.statusHeartbeat = null;
    this.activeUploads = 0;
    this.activeProcessing = 0;
    this.waitingProcessing = 0;
    this.activeHeavyProcessing = 0;
    this.activeQueues.clear();
    this.waitingHeavyQueues.clear();
    this.notifyStateChange();
  }

  private canStartHeavyProcessing(queue?: string) {
    return (
      this.activeUploads === 0 &&
      !this.idleTimer &&
      !this.userIdleTimer &&
      this.activeProcessing === 0 &&
      this.waitingProcessing === 0 &&
      this.activeHeavyProcessing === 0 &&
      !this.hasHigherPriorityHeavyWaiter(queue)
    );
  }

  private hasHigherPriorityHeavyWaiter(queue?: string) {
    const priority = this.heavyQueuePriority(queue);
    return [...this.waitingHeavyQueues].some(
      ([waitingQueue, count]) =>
        count > 0 && waitingQueue !== queue && this.heavyQueuePriority(waitingQueue) < priority,
    );
  }

  private heavyQueuePriority(queue?: string) {
    const index = queue ? BackgroundTaskGate.HEAVY_QUEUE_PRIORITY.indexOf(queue) : -1;
    return index < 0 ? BackgroundTaskGate.HEAVY_QUEUE_PRIORITY.length : index;
  }

  private markHeavyQueueWaiting(queue: string | undefined, delta: number) {
    const key = queue ?? 'unspecified';
    const count = Math.max(0, (this.waitingHeavyQueues.get(key) ?? 0) + delta);
    if (count === 0) this.waitingHeavyQueues.delete(key);
    else this.waitingHeavyQueues.set(key, count);
  }

  private canStartMediaProcessing() {
    const concurrency = this.userIdleTimer
      ? this.activeUserConcurrency
      : this.processingConcurrency;
    return (
      this.activeUploads === 0 &&
      !this.idleTimer &&
      this.activeHeavyProcessing === 0 &&
      this.activeProcessing < concurrency
    );
  }

  private finishUploadIdlePeriod() {
    if (this.activeUploads > 0) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.notifyStateChange();
  }

  private finishUserIdlePeriod() {
    if (this.userIdleTimer) clearTimeout(this.userIdleTimer);
    this.userIdleTimer = null;
    this.notifyStateChange();
  }

  private waitForStateChange() {
    return new Promise<void>((resolve) => this.stateWaiters.add(resolve));
  }

  private markQueueStarted(queue?: string) {
    if (!queue) return;
    this.activeQueues.set(queue, (this.activeQueues.get(queue) ?? 0) + 1);
  }

  private markQueueFinished(queue?: string) {
    if (!queue) return;
    const remaining = Math.max(0, (this.activeQueues.get(queue) ?? 0) - 1);
    if (remaining === 0) this.activeQueues.delete(queue);
    else this.activeQueues.set(queue, remaining);
  }

  private notifyStateChange() {
    for (const resolve of this.stateWaiters) resolve();
    this.stateWaiters.clear();
    this.publishStatus();
  }

  private publishStatus() {
    if (process.env.IMADEO_ROLE === 'api') return;
    void this.signals.publishWorkerStatus(this.getStatus());
  }
}
