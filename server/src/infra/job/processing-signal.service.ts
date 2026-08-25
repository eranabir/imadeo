import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/configuration';
import { QUEUE } from './job.constants';

export interface ProcessingSchedulerStatus {
  workerOnline: boolean;
  mode: 'uploading' | 'interactive' | 'idle';
  activeUploads: number;
  media: { active: number; waiting: number; limit: number };
  heavy: { active: number };
  activeQueues: Record<string, number>;
}

/**
 * The API and media worker are separate processes, so upload priority and the
 * worker's actual activity must cross that boundary through Redis. Uploads are
 * expiring tokens rather than a counter: a killed request can never leave the
 * processing pipeline paused forever.
 */
@Injectable()
export class ProcessingSignalService implements OnModuleDestroy {
  private static readonly UPLOADS_KEY = 'imadeo:processing:active-uploads';
  private static readonly WORKER_STATUS_KEY = 'imadeo:processing:worker-status';
  private static readonly USER_ACTIVITY_KEY = 'imadeo:processing:user-active';
  private static readonly CANCELLED_UPLOAD_PREFIX = 'imadeo:uploads:cancelled';
  private static readonly CANCELLED_UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
  private static readonly HEARTBEAT_MS = 10_000;
  private readonly logger = new Logger(ProcessingSignalService.name);
  private readonly uploadIdleMs: number;
  private readonly userIdleMs: number;
  private readonly staleUploadMs: number;
  private readonly heartbeats = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectQueue(QUEUE.MAINTENANCE) private readonly maintenanceQueue: Queue,
    config: ConfigService<AppConfig, true>,
  ) {
    this.uploadIdleMs = Math.max(0, config.get('jobs.uploadIdleMs', { infer: true }));
    this.userIdleMs = Math.max(0, config.get('jobs.userIdleMs', { infer: true }));
    this.staleUploadMs = Math.max(60_000, this.uploadIdleMs + 30_000);
  }

  noteUserActivity() {
    if (this.userIdleMs === 0) return;
    void this.publishUserActivity();
  }

  beginUpload() {
    const token = randomUUID();
    void this.touchUpload(token, Date.now() + this.staleUploadMs);
    const timer = setInterval(() => {
      void this.touchUpload(token, Date.now() + this.staleUploadMs);
    }, ProcessingSignalService.HEARTBEAT_MS) as unknown as NodeJS.Timeout;
    timer.unref();
    this.heartbeats.set(token, timer);

    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      this.heartbeats.delete(token);
      void this.finishUpload(token);
    };
  }

  async activeUploadCount() {
    try {
      const redis = await this.redis();
      const now = Date.now();
      await redis.zremrangebyscore(ProcessingSignalService.UPLOADS_KEY, '-inf', now);
      return await redis.zcard(ProcessingSignalService.UPLOADS_KEY);
    } catch (error) {
      this.logger.warn(`Could not read upload-priority state: ${String(error)}`);
      return 0;
    }
  }

  async userIsActive() {
    if (this.userIdleMs === 0) return false;
    try {
      const redis = await this.redis();
      return Boolean(await redis.get(ProcessingSignalService.USER_ACTIVITY_KEY));
    } catch (error) {
      this.logger.warn(`Could not read foreground activity: ${String(error)}`);
      return false;
    }
  }

  async waitForBackgroundWindow(pollMs = 500) {
    while (!(await this.backgroundWindowIsOpen())) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  async backgroundWindowIsOpen() {
    return (await this.activeUploadCount()) === 0 && !(await this.userIsActive());
  }

  async publishWorkerStatus(status: ProcessingSchedulerStatus) {
    try {
      const redis = await this.redis();
      await redis.set(
        ProcessingSignalService.WORKER_STATUS_KEY,
        JSON.stringify(status),
        'PX',
        15_000,
      );
    } catch (error) {
      this.logger.warn(`Could not publish processing state: ${String(error)}`);
    }
  }

  async readWorkerStatus(): Promise<ProcessingSchedulerStatus | null> {
    try {
      const redis = await this.redis();
      const value = await redis.get(ProcessingSignalService.WORKER_STATUS_KEY);
      return value ? (JSON.parse(value) as ProcessingSchedulerStatus) : null;
    } catch (error) {
      this.logger.warn(`Could not read processing state: ${String(error)}`);
      return null;
    }
  }

  /**
   * A browser may retry an upload after its response was lost. Remembering the
   * receipt of a trashed asset prevents that stale retry from restoring the
   * photo behind the user's back. Fresh selections use a new receipt id.
   */
  async cancelUploadReceipts(userId: string, uploadIds: string[]) {
    const ids = [...new Set(uploadIds)].filter(Boolean);
    if (ids.length === 0) return;
    try {
      const redis = await this.redis();
      const pipeline = redis.pipeline();
      for (const uploadId of ids) {
        pipeline.set(
          this.cancelledUploadKey(userId, uploadId),
          '1',
          'PX',
          ProcessingSignalService.CANCELLED_UPLOAD_TTL_MS,
        );
      }
      await pipeline.exec();
    } catch (error) {
      this.logger.warn(`Could not cancel upload receipts: ${String(error)}`);
    }
  }

  async clearCancelledUploadReceipts(userId: string, uploadIds: string[]) {
    const keys = [...new Set(uploadIds)]
      .filter(Boolean)
      .map((uploadId) => this.cancelledUploadKey(userId, uploadId));
    if (keys.length === 0) return;
    try {
      const redis = await this.redis();
      await redis.del(...keys);
    } catch (error) {
      this.logger.warn(`Could not restore upload receipts: ${String(error)}`);
    }
  }

  async uploadReceiptIsCancelled(userId: string, uploadId: string) {
    try {
      const redis = await this.redis();
      return Boolean(await redis.get(this.cancelledUploadKey(userId, uploadId)));
    } catch (error) {
      this.logger.warn(`Could not read upload cancellation state: ${String(error)}`);
      return false;
    }
  }

  onModuleDestroy() {
    for (const timer of this.heartbeats.values()) clearInterval(timer);
    this.heartbeats.clear();
  }

  private async touchUpload(token: string, expiresAt: number) {
    try {
      const redis = await this.redis();
      await redis.zadd(ProcessingSignalService.UPLOADS_KEY, expiresAt, token);
    } catch (error) {
      this.logger.warn(`Could not publish upload-priority state: ${String(error)}`);
    }
  }

  private async publishUserActivity() {
    try {
      const redis = await this.redis();
      await redis.set(
        ProcessingSignalService.USER_ACTIVITY_KEY,
        '1',
        'PX',
        this.userIdleMs,
      );
    } catch (error) {
      this.logger.warn(`Could not publish foreground activity: ${String(error)}`);
    }
  }

  private async finishUpload(token: string) {
    try {
      const redis = await this.redis();
      if (this.uploadIdleMs === 0) {
        await redis.zrem(ProcessingSignalService.UPLOADS_KEY, token);
      } else {
        await redis.zadd(
          ProcessingSignalService.UPLOADS_KEY,
          Date.now() + this.uploadIdleMs,
          token,
        );
      }
    } catch (error) {
      this.logger.warn(`Could not finish upload-priority state: ${String(error)}`);
    }
  }

  private cancelledUploadKey(userId: string, uploadId: string) {
    return `${ProcessingSignalService.CANCELLED_UPLOAD_PREFIX}:${userId}:${uploadId}`;
  }

  private async redis() {
    // Imadeo configures BullMQ with ioredis. BullMQ exposes only the commands
    // it uses in its narrow public type, so use the concrete client for the
    // coordination keys owned by Imadeo itself.
    return (await this.maintenanceQueue.client) as unknown as Redis;
  }
}
