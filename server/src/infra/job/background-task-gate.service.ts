import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';

/**
 * Lets uploads and thumbnail generation take priority over background inference.
 *
 * A short grace period keeps the gate closed between consecutive file requests,
 * so a browser sending four files at a time does not restart ML in every gap.
 * Thumbnail and ML operations also share a strict, thumbnail-first CPU lane.
 */
@Injectable()
export class BackgroundTaskGate implements OnModuleDestroy {
  private readonly uploadIdleMs: number;
  private readonly stateWaiters = new Set<() => void>();
  private activeUploads = 0;
  private activeThumbnails = 0;
  private waitingThumbnails = 0;
  private activeMachineLearning = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(config: ConfigService<AppConfig, true>) {
    this.uploadIdleMs = Math.max(0, config.get('jobs.uploadIdleMs', { infer: true }));
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
   * Gives thumbnails priority over inference while ensuring the two CPU-heavy
   * pipelines never overlap. Existing inference finishes at its next yield
   * point, then every waiting thumbnail runs before ML can resume.
   */
  async runThumbnail<T>(operation: () => Promise<T>): Promise<T> {
    this.waitingThumbnails += 1;
    try {
      while (this.activeMachineLearning > 0) await this.waitForStateChange();
      this.activeThumbnails += 1;
    } finally {
      this.waitingThumbnails = Math.max(0, this.waitingThumbnails - 1);
    }

    try {
      return await operation();
    } finally {
      this.activeThumbnails = Math.max(0, this.activeThumbnails - 1);
      this.notifyStateChange();
    }
  }

  /** Runs one inference operation only when uploads and thumbnails are idle. */
  async runMachineLearning<T>(operation: () => Promise<T>): Promise<T> {
    while (!this.canStartMachineLearning()) await this.waitForStateChange();
    this.activeMachineLearning += 1;

    try {
      return await operation();
    } finally {
      this.activeMachineLearning = Math.max(0, this.activeMachineLearning - 1);
      this.notifyStateChange();
    }
  }

  onModuleDestroy() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.activeUploads = 0;
    this.activeThumbnails = 0;
    this.waitingThumbnails = 0;
    this.activeMachineLearning = 0;
    this.notifyStateChange();
  }

  private canStartMachineLearning() {
    return (
      this.activeUploads === 0 &&
      !this.idleTimer &&
      this.activeThumbnails === 0 &&
      this.waitingThumbnails === 0 &&
      this.activeMachineLearning === 0
    );
  }

  private finishUploadIdlePeriod() {
    if (this.activeUploads > 0) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
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
