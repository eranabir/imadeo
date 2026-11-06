import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { UserStatus } from '../../db';
import { DEFAULT_JOB_OPTIONS, JOB, PROCESSORS_AUTORUN, QUEUE } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { BULK_MUTATION_TRANSACTION } from '../../infra/prisma/bulk-mutation';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';

export const USER_DELETION_GRACE_DAYS = 30;
const GRACE_MS = USER_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;
const USER_MUTATION_LOCK = 'SELECT pg_advisory_xact_lock(79218461)';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UserDeletionJobData {
  userId: string;
  /** Exact deletion request; an old job must never erase a restored account. */
  deletedAt: string;
}

type RemovalUser = { id: string; email: string; status: UserStatus; deletedAt: Date | null };
const userSelect = { id: true, email: true, status: true, deletedAt: true } as const;
const assetSelect = { id: true, originalPath: true, isExternal: true,
  thumbnailPath: true, previewPath: true, encodedVideoPath: true } as const;

/** Only explicit self-deletion requests create jobs; existing disabled users are untouched. */
@Injectable()
export class UserDeletionService {
  constructor(
    @InjectQueue(QUEUE.MAINTENANCE) private readonly queue: Queue,
    @InjectQueue(QUEUE.FACE_CLUSTER) private readonly faceCluster: Queue,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobService,
  ) {}

  /** Enqueue inside the request transaction, so Redis failure leaves the account active. */
  async schedule(userId: string, deletedAt: Date) {
    if (!UUID.test(userId) || !Number.isFinite(deletedAt.getTime())) throw new Error('Invalid account deletion request');
    return this.queue.add(JOB.DELETE_USER, { userId, deletedAt: deletedAt.toISOString() }, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: `${JOB.DELETE_USER}--${userId}--${deletedAt.getTime()}`,
      delay: Math.max(0, deletedAt.getTime() + GRACE_MS - Date.now()),
      attempts: 10,
      backoff: { type: 'exponential', delay: 60_000 },
      // A failed purge stays visible to the operator until it is retried.
      removeOnFail: false,
    });
  }

  async purge(data: UserDeletionJobData) {
    const requestedAt = new Date(data.deletedAt);
    if (!UUID.test(data.userId) || !Number.isFinite(requestedAt.getTime())) throw new Error('Invalid account deletion job');
    const target = await this.prisma.user.findUnique({ where: { id: data.userId }, select: userSelect });
    if (!this.matches(target, requestedAt)) return { skipped: 'account restored, replaced, or already removed' };
    this.assertGraceElapsed(requestedAt);

    const root = this.userRoot(data.userId);
    const assets = await this.prisma.asset.findMany({ where: { ownerId: data.userId }, select: assetSelect });
    this.assertManagedPaths(root, assets);

    // Claim a permanent deletion while holding the same lock used by restore.
    // Filesystem work runs afterwards, so a slow NAS never outlives a DB lock.
    const claimed = await this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(USER_MUTATION_LOCK);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${data.userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: data.userId }, select: userSelect });
      if (!this.matches(user, requestedAt)) return null;
      this.assertGraceElapsed(requestedAt);
      if (user.status === UserStatus.REMOVING) {
        await tx.user.update({ where: { id: user.id }, data: { status: UserStatus.DELETED } });
      }
      await tx.asset.updateMany({ where: { ownerId: data.userId, deletedAt: null },
        data: { deletedAt: new Date(), status: 'TRASHED' } });
      return user;
    }, BULK_MUTATION_TRANSACTION);
    if (!claimed) return { skipped: 'account restored or deletion request replaced' };

    // Only a successfully claimed account may lose queued work. The committed
    // asset flags make active processing stop cooperatively before files move.
    const remaining = await this.prisma.asset.findMany({ where: { ownerId: data.userId }, select: assetSelect });
    this.assertManagedPaths(root, remaining);
    await this.stopProcessing(data.userId, remaining.map(asset => asset.id));
    // Unlike StorageService.remove, this must throw on failure so BullMQ retries.
    // External-library originals outside this dedicated tree remain untouched.
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

    await this.prisma.$transaction(async tx => {
      await tx.auditLog.deleteMany({ where: { userId: data.userId } });
      await tx.invitation.deleteMany({ where: { OR: [{ email: claimed.email }, { invitedById: data.userId }] } });
      const result = await tx.user.deleteMany({ where: { id: data.userId,
        status: UserStatus.DELETED, deletedAt: requestedAt } });
      if (result.count !== 1) throw new Error('Account deletion changed before final cleanup');
    }, BULK_MUTATION_TRANSACTION);
    return { deleted: true };
  }

  private matches(user: RemovalUser | null, requestedAt: Date): user is RemovalUser {
    return Boolean(user && (user.status === UserStatus.REMOVING || user.status === UserStatus.DELETED)
      && user.deletedAt?.getTime() === requestedAt.getTime());
  }

  private assertGraceElapsed(requestedAt: Date) {
    if (Date.now() < requestedAt.getTime() + GRACE_MS) throw new Error('Account deletion retention period has not elapsed');
  }

  private userRoot(userId: string) {
    const users = resolve(this.storage.buildUserRoot(''));
    const root = resolve(this.storage.buildUserRoot(userId));
    if (relative(users, root) !== userId) throw new Error('Invalid account storage directory');
    return this.storage.assertInsideRoot(root);
  }

  private assertManagedPaths(root: string, assets: Array<{
    originalPath: string; isExternal: boolean; thumbnailPath: string | null;
    previewPath: string | null; encodedVideoPath: string | null;
  }>) {
    for (const asset of assets) {
      const paths = [asset.thumbnailPath, asset.previewPath, asset.encodedVideoPath,
        ...(asset.isExternal ? [] : [asset.originalPath])];
      for (const path of paths) {
        if (!path) continue;
        const child = relative(root, resolve(path));
        if (!child || child === '..' || child.startsWith('../') || isAbsolute(child)) {
          throw new Error('Managed media is outside its account storage directory');
        }
      }
    }
  }

  private async stopProcessing(userId: string, assetIds: string[]) {
    if (assetIds.length) {
      await this.jobs.cancelAssetProcessing(assetIds);
      const owned = new Set(assetIds);
      const snapshot = await this.jobs.getAssetProcessingSnapshot();
      if (snapshot.activeJobs.some(job => owned.has(job.assetId))) throw new Error('Waiting for account media processing to stop');
    }
    const clustering = await this.faceCluster.getJob(`${JOB.CLUSTER_FACES}--${userId}`);
    if (clustering) {
      if ((await clustering.getState()) === 'active') throw new Error('Waiting for account face clustering to stop');
      await clustering.remove();
    }
  }
}

@Processor(QUEUE.MAINTENANCE, { concurrency: 1, autorun: PROCESSORS_AUTORUN })
export class UserDeletionProcessor extends WorkerHost {
  constructor(private readonly deletions: UserDeletionService) { super(); }

  process(job: Job<UserDeletionJobData>) {
    if (job.name !== JOB.DELETE_USER) return Promise.resolve({ skipped: 'unsupported maintenance job' });
    return this.deletions.purge(job.data);
  }
}
