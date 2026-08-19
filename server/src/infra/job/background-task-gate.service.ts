import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';

/**
 * Keeps user requests responsive without stopping the processing pipeline.
 *
 * A short grace period keeps the gate closed between consecutive file requests,
 * so a browser sending four files at a time does not restart ML in every gap.
 * Uploads pause all derivative work. Active browsing leaves one media slot
 * running, while an idle application expands to the configured concurrency.
 * CPU-heavy work runs only after media work and real interaction are quiet.
 */
@Injectable()
export class BackgroundTaskGate implements OnModuleDestroy {
  private readonly uploadIdleMs: number;
  private readonly userIdleMs: number;
  private readonly processingConcurrency: number;
  private readonly activeUserConcurrency: number;
  private readonly stateWaiters = new Set<() => void>();
  private activeUploads = 0;
  private activeProcessing = 0;
  private waitingProcessing = 0;
  private activeHeavyProcessing = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private userIdleTimer: NodeJS.Timeout | null = null;

  constructor(config: ConfigService<AppConfig, true>) {
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
  }

  /**
   * Extends the quiet window after a real browser interaction. The client
   * throttles these signals, so background polling does not starve the queues.
   */
  noteUserActivity() {
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
    this.activeUploads += 1;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
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
   * reduces its concurrency instead of freezing it, so progress remains visible.
   */
  async runMediaProcessing<T>(operation: () => Promise<T>): Promise<T> {
    this.waitingProcessing += 1;
    try {
      while (!this.canStartMediaProcessing()) await this.waitForStateChange();
      this.activeProcessing += 1;
    } finally {
      this.waitingProcessing = Math.max(0, this.waitingProcessing - 1);
    }

    try {
      return await operation();
    } finally {
      this.activeProcessing = Math.max(0, this.activeProcessing - 1);
      this.notifyStateChange();
    }
  }

  /** Backwards-compatible name used by the thumbnail processor. */
  runThumbnail<T>(operation: () => Promise<T>): Promise<T> {
    return this.runMediaProcessing(operation);
  }

  /** Runs transcoding, duplicate scans and inference only during quiet periods. */
  async runHeavyProcessing<T>(operation: () => Promise<T>): Promise<T> {
    while (!this.canStartHeavyProcessing()) await this.waitForStateChange();
    this.activeHeavyProcessing += 1;

    try {
      return await operation();
    } finally {
      this.activeHeavyProcessing = Math.max(0, this.activeHeavyProcessing - 1);
      this.notifyStateChange();
    }
  }

  /** Backwards-compatible semantic name used by ML processors. */
  runMachineLearning<T>(operation: () => Promise<T>): Promise<T> {
    return this.runHeavyProcessing(operation);
  }

  onModuleDestroy() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.userIdleTimer) clearTimeout(this.userIdleTimer);
    this.idleTimer = null;
    this.userIdleTimer = null;
    this.activeUploads = 0;
    this.activeProcessing = 0;
    this.waitingProcessing = 0;
    this.activeHeavyProcessing = 0;
    this.notifyStateChange();
  }

  private canStartHeavyProcessing() {
    return (
      this.activeUploads === 0 &&
      !this.idleTimer &&
      !this.userIdleTimer &&
      this.activeProcessing === 0 &&
      this.waitingProcessing === 0 &&
      this.activeHeavyProcessing === 0
    );
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

  private notifyStateChange() {
    for (const resolve of this.stateWaiters) resolve();
    this.stateWaiters.clear();
  }
}
