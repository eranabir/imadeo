import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserStatus } from '../../db';
import { JOB } from '../../infra/job/job.constants';

const files = vi.hoisted(() => ({ rm: vi.fn() }));
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(), rm: files.rm,
}));
import { UserDeletionProcessor, UserDeletionService, USER_DELETION_GRACE_DAYS } from './user-deletion.service';

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-06T12:00:00.000Z');
const requestedAt = new Date('2026-10-06T12:00:00.000Z');
const data = { userId, deletedAt: requestedAt.toISOString() };
let directory: string;
let realRm: typeof import('node:fs/promises').rm;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  realRm = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rm;
  files.rm.mockReset().mockImplementation(realRm);
  directory = await mkdtemp(join(tmpdir(), 'imadeo-deletion-test-'));
});
afterEach(async () => {
  await realRm(directory, { recursive: true, force: true });
  vi.useRealTimers();
});

async function fixture() {
  const root = join(directory, 'users', userId);
  const other = join(directory, 'users', otherId, 'photo.jpg');
  await mkdir(join(root, 'library'), { recursive: true });
  await mkdir(join(directory, 'users', otherId), { recursive: true });
  const original = join(root, 'library', 'photo.jpg');
  await writeFile(original, 'owned photo');
  await writeFile(other, 'other account photo');
  let user: { id: string; email: string; status: UserStatus; deletedAt: Date | null } | null = {
    id: userId, email: 'owner@example.com', status: UserStatus.REMOVING, deletedAt: requestedAt,
  };
  const assets = [{ id: 'owned-asset', originalPath: original, isExternal: false,
    thumbnailPath: null as string | null, previewPath: null, encodedVideoPath: null }];
  const findUser = vi.fn(async () => user && { ...user });
  const updateUser = vi.fn(async ({ data: update }: any) => { Object.assign(user!, update); return user; });
  const deleteUser = vi.fn(async () => { user = null; return { count: 1 }; });
  const assetUpdate = vi.fn(async () => ({ count: assets.length }));
  const tx = {
    $executeRawUnsafe: vi.fn(async () => 1), $queryRaw: vi.fn(async () => [{ id: userId }]),
    user: { findUnique: findUser, update: updateUser, deleteMany: deleteUser },
    asset: { updateMany: assetUpdate },
    auditLog: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    invitation: { deleteMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    user: { findUnique: findUser },
    asset: { findMany: vi.fn(async () => assets) },
    $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
  };
  const queue = { add: vi.fn(async () => ({ id: 'scheduled' })) };
  const faceCluster = { getJob: vi.fn(async (): Promise<any> => undefined) };
  const jobs = {
    cancelAssetProcessing: vi.fn(async () => 0),
    getAssetProcessingSnapshot: vi.fn(async () => ({ activeJobs: [] as { assetId: string }[] })),
  };
  const storage = {
    buildUserRoot: (id: string) => join(directory, 'users', id),
    assertInsideRoot: (path: string) => {
      const rel = relative(directory, resolve(path));
      if (rel.startsWith('..')) throw new Error('Outside storage');
      return path;
    },
  };
  const service = new UserDeletionService(queue as never, faceCluster as never, prisma as never,
    storage as never, jobs as never);
  return { service, root, other, original, assets, tx, prisma, queue, faceCluster, jobs,
    findUser, updateUser, deleteUser, user: () => user };
}

describe('explicit account deletion jobs', () => {
  it('only schedules an explicit request with its exact timestamp and a30-day delay', async () => {
    const test = await fixture();
    expect(test.queue.add).not.toHaveBeenCalled();
    expect(test.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(USER_DELETION_GRACE_DAYS).toBe(30);
    await test.service.schedule(userId, now);
    expect(test.queue.add).toHaveBeenCalledExactlyOnceWith(JOB.DELETE_USER,
      { userId, deletedAt: now.toISOString() }, expect.objectContaining({
        delay: 30 * 24 * 60 * 60 * 1000,
        jobId: `${JOB.DELETE_USER}--${userId}--${now.getTime()}`,
        attempts: 10, removeOnFail: false,
      }));
  });

  it('propagates scheduling failure so the request transaction can roll back', async () => {
    const test = await fixture();
    test.queue.add.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(test.service.schedule(userId, now)).rejects.toThrow('Redis unavailable');
    expect(test.updateUser).not.toHaveBeenCalled();
  });

  it.each([UserStatus.ACTIVE, UserStatus.REMOVING])('ignores obsolete jobs for status %s or a newer request', async status => {
    const test = await fixture();
    Object.assign(test.user()!, { status, deletedAt: new Date('2026-11-01T12:00:00Z') });
    await expect(test.service.purge(data)).resolves.toHaveProperty('skipped');
    expect(files.rm).not.toHaveBeenCalled();
    expect(test.prisma.asset.findMany).not.toHaveBeenCalled();
    expect(await readFile(test.original, 'utf8')).toBe('owned photo');
  });

  it('never removes an account before its retention period expires', async () => {
    const test = await fixture();
    test.user()!.deletedAt = now;
    await expect(test.service.purge({ userId, deletedAt: now.toISOString() })).rejects.toThrow('retention period');
    expect(test.updateUser).not.toHaveBeenCalled();
    expect(files.rm).not.toHaveBeenCalled();
  });

  it('claims deletion before removing owned files and clears account records afterwards', async () => {
    const test = await fixture();
    files.rm.mockImplementationOnce(async (...args: Parameters<typeof realRm>) => {
      expect(test.user()!.status).toBe(UserStatus.DELETED);
      expect(test.deleteUser).not.toHaveBeenCalled();
      return realRm(...args);
    });
    await expect(test.service.purge(data)).resolves.toEqual({ deleted: true });
    expect(test.tx.$executeRawUnsafe).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(79218461)');
    expect(test.tx.$queryRaw).toHaveBeenCalled();
    expect(test.tx.asset.updateMany).toHaveBeenCalledWith({ where: { ownerId: userId, deletedAt: null },
      data: { deletedAt: now, status: 'TRASHED' } });
    expect(test.tx.auditLog.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(test.tx.invitation.deleteMany).toHaveBeenCalledWith({ where: { OR: [{ email: 'owner@example.com' }, { invitedById: userId }] } });
    expect(test.deleteUser).toHaveBeenCalledWith({ where: { id: userId, status: UserStatus.DELETED, deletedAt: requestedAt } });
    expect(test.user()).toBeNull();
    await expect(readFile(test.original)).rejects.toThrow();
    expect(await readFile(test.other, 'utf8')).toBe('other account photo');
    await expect(test.service.purge(data)).resolves.toHaveProperty('skipped');
    expect(files.rm).toHaveBeenCalledOnce();
  });

  it('lets a restore win the claim without deleting its files', async () => {
    const test = await fixture();
    test.findUser.mockResolvedValueOnce({ ...test.user()! }).mockResolvedValueOnce({
      ...test.user()!, status: UserStatus.ACTIVE, deletedAt: null,
    });
    await expect(test.service.purge(data)).resolves.toHaveProperty('skipped');
    expect(test.updateUser).not.toHaveBeenCalled();
    expect(test.jobs.cancelAssetProcessing).not.toHaveBeenCalled();
    expect(test.faceCluster.getJob).not.toHaveBeenCalled();
    expect(files.rm).not.toHaveBeenCalled();
    expect(await readFile(test.original, 'utf8')).toBe('owned photo');
  });

  it('claims the account but waits for active media work before touching files', async () => {
    const test = await fixture();
    test.jobs.getAssetProcessingSnapshot.mockResolvedValueOnce({ activeJobs: [{ assetId: 'owned-asset' }] });
    await expect(test.service.purge(data)).rejects.toThrow('processing to stop');
    expect(test.user()!.status).toBe(UserStatus.DELETED);
    expect(files.rm).not.toHaveBeenCalled();
    expect(test.jobs.cancelAssetProcessing).toHaveBeenCalledWith(['owned-asset']);
  });

  it('does not block deletion on active work owned by another account', async () => {
    const test = await fixture();
    test.jobs.getAssetProcessingSnapshot.mockResolvedValue({ activeJobs: [{ assetId: 'other-asset' }] });
    await expect(test.service.purge(data)).resolves.toEqual({ deleted: true });
    expect(await readFile(test.other, 'utf8')).toBe('other account photo');
  });

  it('guards work that starts during the claim and retries from the DELETED state', async () => {
    const test = await fixture();
    test.jobs.getAssetProcessingSnapshot.mockResolvedValueOnce({ activeJobs: [{ assetId: 'owned-asset' }] });
    await expect(test.service.purge(data)).rejects.toThrow('processing to stop');
    expect(test.user()!.status).toBe(UserStatus.DELETED);
    expect(files.rm).not.toHaveBeenCalled();
    await expect(test.service.purge(data)).resolves.toEqual({ deleted: true });
  });

  it('keeps the irreversible claim on filesystem failure and safely retries', async () => {
    const test = await fixture();
    files.rm.mockRejectedValueOnce(new Error('NAS permission denied'));
    await expect(test.service.purge(data)).rejects.toThrow('NAS permission denied');
    expect(test.user()!.status).toBe(UserStatus.DELETED);
    expect(test.deleteUser).not.toHaveBeenCalled();
    await expect(test.service.purge(data)).resolves.toEqual({ deleted: true });
  });

  it('retries DB failure after file removal without needing the files to exist', async () => {
    const test = await fixture();
    test.deleteUser.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(test.service.purge(data)).rejects.toThrow('Database unavailable');
    expect(test.user()!.status).toBe(UserStatus.DELETED);
    await expect(readFile(test.original)).rejects.toThrow();
    await expect(test.service.purge(data)).resolves.toEqual({ deleted: true });
  });

  it('refuses a managed path belonging to another account', async () => {
    const test = await fixture();
    test.assets[0].originalPath = test.other;
    await expect(test.service.purge(data)).rejects.toThrow('outside its account');
    expect(test.updateUser).not.toHaveBeenCalled();
    expect(files.rm).not.toHaveBeenCalled();
    expect(await readFile(test.other, 'utf8')).toBe('other account photo');
  });

  it('removes external-library metadata while preserving the operator original outside account storage', async () => {
    const test = await fixture();
    test.assets[0].isExternal = true;
    test.assets[0].originalPath = test.other;
    await expect(test.service.purge(data)).resolves.toEqual({ deleted: true });
    expect(await readFile(test.other, 'utf8')).toBe('other account photo');
  });

  it('waits for face clustering, then removes its obsolete queued job', async () => {
    const test = await fixture();
    const remove = vi.fn();
    const getState = vi.fn().mockResolvedValueOnce('active').mockResolvedValue('waiting');
    test.faceCluster.getJob.mockResolvedValue({ getState, remove });
    await expect(test.service.purge(data)).rejects.toThrow('face clustering');
    expect(test.user()!.status).toBe(UserStatus.DELETED);
    await expect(test.service.purge(data)).resolves.toEqual({ deleted: true });
    expect(remove).toHaveBeenCalled();
  });

  it('rejects malformed job identities before touching database or filesystem', async () => {
    const test = await fixture();
    await expect(test.service.purge({ userId: '..', deletedAt: data.deletedAt })).rejects.toThrow('Invalid account deletion job');
    expect(test.findUser).not.toHaveBeenCalled();
    expect(files.rm).not.toHaveBeenCalled();
  });

  it('dispatches only explicitly named account deletion jobs', async () => {
    const purge = vi.fn(async () => ({ deleted: true }));
    const processor = new UserDeletionProcessor({ purge } as never);
    await expect(processor.process({ name: JOB.EMPTY_TRASH, data } as never)).resolves.toHaveProperty('skipped');
    expect(purge).not.toHaveBeenCalled();
    await expect(processor.process({ name: JOB.DELETE_USER, data } as never)).resolves.toEqual({ deleted: true });
    expect(purge).toHaveBeenCalledExactlyOnceWith(data);
  });
});
