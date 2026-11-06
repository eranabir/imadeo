import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { UserStatus } from '../../db';
import { UserController } from './user.controller';
import { UserService } from './user.service';

vi.mock('bcrypt', () => ({ compare: vi.fn(async (value: string) => value === 'correct-password'), hash: vi.fn(async () => 'new-hash') }));
const account = (id: string, isAdmin = false, password = 'password-hash') => ({
  id, email: `${id}@example.com`, name: id, isAdmin, password, status: UserStatus.ACTIVE as UserStatus, deletedAt: null as Date | null,
});
function setup(initial = [account('owner')]) {
  const users = new Map(initial.map(user => [user.id, { ...user }]));
  const matches = (user: ReturnType<typeof account>, where: any = {}) =>
    (!where.id || typeof where.id === 'string' ? !where.id || where.id === user.id : where.id.not !== user.id)
    && (!where.NOT?.id || where.NOT.id !== user.id)
    && (where.email === undefined || where.email === user.email)
    && (where.isAdmin === undefined || where.isAdmin === user.isAdmin)
    && (where.status === undefined || where.status === user.status)
    && (where.deletedAt === undefined || where.deletedAt === user.deletedAt);
  const user = {
    findUnique: vi.fn(async ({ where }: any) => [...users.values()].find(user => matches(user, where)) ?? null),
    create: vi.fn(async ({ data }: any) => { const created = { ...account('created'), ...data }; users.set(created.id, created); return created; }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const result = users.get(where.id); if (!result) throw new Error('Missing user'); return { ...result };
    }),
    findFirst: vi.fn(async ({ where }: any) => [...users.values()].find(user => matches(user, where)) ?? null),
    findMany: vi.fn(async ({ where }: any) => [...users.values()].filter(user => matches(user, where))),
    count: vi.fn(async ({ where }: any) => [...users.values()].filter(user => matches(user, where)).length),
    update: vi.fn(async ({ where, data }: any) => {
      const current = users.get(where.id)!;
      const next = { ...current, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) };
      users.set(where.id, next); return { ...next };
    }),
    deleteMany: vi.fn(),
  };
  const tx = {
    user, $executeRawUnsafe: vi.fn(async () => 1),
    session: { deleteMany: vi.fn(async () => ({ count: 2 })) },
    apiKey: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    sharedLink: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    invitation: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    assetUser: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    albumUser: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    folderUser: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    partner: { deleteMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (work: (tx: any) => unknown) => {
    const before = new Map([...users].map(([id, user]) => [id, { ...user }]));
    try { return await work(tx); } catch (cause) { users.clear(); before.forEach((value, key) => users.set(key, value)); throw cause; }
  }) };
  const schedule = vi.fn(async (_id: string, _at: Date) => undefined);
  const ensureUserRoot = vi.fn(async () => undefined);
  const service = new UserService(prisma as never, {} as never, {} as never, { ensureUserRoot } as never, { schedule } as never);
  const body = { confirmationEmail: 'owner@example.com', currentPassword: 'correct-password' };
  return { users, user, tx, prisma, schedule, service, body };
}

describe('self-service account deletion', () => {
  it('queues only the authenticated account, revokes access and sharing, and returns the real 30-day date', async () => {
    const test = setup();
    const result = await test.service.deleteOwnAccount('owner', test.body);
    expect(test.schedule).toHaveBeenCalledExactlyOnceWith('owner', expect.any(Date));
    const date = test.schedule.mock.calls[0][1];
    expect(result).toEqual({ deletedAt: date.toISOString(), gracePeriodDays: 30,
      deleteAfter: new Date(date.getTime() + 30 * 86_400_000).toISOString() });
    expect(test.users.get('owner')).toMatchObject({ status: UserStatus.REMOVING, deletedAt: date });
    for (const table of [test.tx.session, test.tx.apiKey, test.tx.sharedLink]) {
      expect(table.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { userId: 'owner' } });
    }
    expect(test.tx.invitation.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { OR: [{ invitedById: 'owner' }, { album: { ownerId: 'owner' } }] } });
    expect(test.tx.assetUser.deleteMany).toHaveBeenCalledWith({ where: { asset: { ownerId: 'owner' } } });
    expect(test.tx.albumUser.deleteMany).toHaveBeenCalledWith({ where: { album: { ownerId: 'owner' } } });
    expect(test.tx.folderUser.deleteMany).toHaveBeenCalledWith({ where: { folder: { ownerId: 'owner' } } });
    expect(test.user.deleteMany).not.toHaveBeenCalled();
    expect(test.schedule.mock.invocationCallOrder[0]).toBeLessThan(test.user.update.mock.invocationCallOrder[0]);
  });
  it('requires the current password when one exists, without queuing or revoking anything on failure', async () => {
    const test = setup();
    await expect(test.service.deleteOwnAccount('owner', { ...test.body, currentPassword: 'wrong' })).rejects.toBeInstanceOf(BadRequestException);
    expect(bcrypt.compare).toHaveBeenCalledWith('wrong', 'password-hash');
    expect(test.schedule).not.toHaveBeenCalled();
    expect(test.tx.session.deleteMany).not.toHaveBeenCalled();
  });
  it('allows a passwordless account with a valid signed-in session to confirm by email', async () => {
    const test = setup([account('owner', false, '')]);
    await expect(test.service.deleteOwnAccount('owner', { confirmationEmail: ' OWNER@example.com ' })).resolves.toMatchObject({ gracePeriodDays: 30 });
  });
  it('does not accept another account email as deletion confirmation', async () => {
    const test = setup();
    await expect(test.service.deleteOwnAccount('owner', { ...test.body, confirmationEmail: 'other@example.com' })).rejects.toThrow('account email');
    expect(test.schedule).not.toHaveBeenCalled();
  });
  it('allows the sole account to delete itself rather than requiring outside support', async () => {
    const test = setup([account('owner', true)]);
    expect(await test.service.deletionOptions('owner')).toMatchObject({ willEmptyServer: true, requiresSuccessor: false });
    await expect(test.service.deleteOwnAccount('owner', test.body)).resolves.toMatchObject({ gracePeriodDays: 30 });
  });
  it('requires the last administrator with other users to choose a successor', async () => {
    const test = setup([account('owner', true), account('member')]);
    expect(await test.service.deletionOptions('owner')).toMatchObject({ requiresSuccessor: true,
      successors: [expect.objectContaining({ id: 'member' })] });
    await expect(test.service.deleteOwnAccount('owner', test.body)).rejects.toThrow('Choose another account');
    expect(test.schedule).not.toHaveBeenCalled();
    expect(test.users.get('owner')?.status).toBe(UserStatus.ACTIVE);
  });
  it('promotes an explicit active successor atomically before removing the last administrator', async () => {
    const test = setup([account('owner', true), account('member')]);
    await test.service.deleteOwnAccount('owner', { ...test.body, successorId: 'member' });
    expect(test.users.get('member')).toMatchObject({ isAdmin: true, status: UserStatus.ACTIVE });
    expect(test.users.get('owner')?.status).toBe(UserStatus.REMOVING);
    expect(test.tx.$executeRawUnsafe).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(79218461)');
    expect(test.tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(test.user.count.mock.invocationCallOrder[0]);
  });
  it.each(['owner', 'missing', 'inactive'])('rejects invalid successor %s without mutating accounts', async successorId => {
    const inactive = { ...account('inactive'), status: UserStatus.REMOVING };
    const test = setup([account('owner', true), account('member'), inactive]);
    await expect(test.service.deleteOwnAccount('owner', { ...test.body, successorId })).rejects.toThrow('active account');
    expect(test.schedule).not.toHaveBeenCalled();
    expect(test.user.update).not.toHaveBeenCalled();
  });
  it('never lets a member promote another account through the deletion DTO', async () => {
    const test = setup([account('owner'), account('member')]);
    await expect(test.service.deleteOwnAccount('owner', { ...test.body, successorId: 'member' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(test.schedule).not.toHaveBeenCalled();
  });
  it('rolls back the request if durable purge scheduling is unavailable', async () => {
    const test = setup([account('owner', true), account('member')]);
    test.schedule.mockRejectedValueOnce(new Error('Redis offline'));
    await expect(test.service.deleteOwnAccount('owner', { ...test.body, successorId: 'member' })).rejects.toThrow('Redis offline');
    expect(test.user.update).not.toHaveBeenCalled();
    expect(test.tx.session.deleteMany).not.toHaveBeenCalled();
    expect(test.users.get('owner')?.status).toBe(UserStatus.ACTIVE);
  });
  it('serializes administrator demotion and removal and protects the last active administrator', async () => {
    const test = setup([account('owner', true), account('member')]);
    await expect(test.service.update('owner', { isAdmin: false })).rejects.toThrow('last administrator');
    await expect(test.service.softDelete('owner', 'other-admin')).rejects.toThrow('last administrator');
    expect(test.tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(test.schedule).not.toHaveBeenCalled();
  });
  it('restores pending accounts under the same lock but never reactivates a claimed purge', async () => {
    const removing = { ...account('owner'), status: UserStatus.REMOVING, deletedAt: new Date() };
    const test = setup([removing]);
    await test.service.restore('owner');
    expect(test.users.get('owner')).toMatchObject({ status: UserStatus.ACTIVE as UserStatus, deletedAt: null });
    test.users.set('owner', { ...removing, status: UserStatus.DELETED });
    await expect(test.service.restore('owner')).rejects.toThrow('Permanent account deletion');
  });
  it('requires explicit acknowledgement when only disabled legacy accounts would remain', async () => {
    const legacy = { ...account('disabled'), status: UserStatus.REMOVING };
    const test = setup([account('owner', true), legacy]);
    expect(await test.service.deletionOptions('owner')).toMatchObject({
      requiresSuccessor: false, willEmptyServer: false, leavesServerWithoutAdmin: true,
    });
    await expect(test.service.deleteOwnAccount('owner', test.body)).rejects.toThrow('without an administrator');
    expect(test.schedule).not.toHaveBeenCalled();
    await test.service.deleteOwnAccount('owner', { ...test.body, acknowledgeServerLockout: true });
    expect(test.schedule).toHaveBeenCalledOnce();
    expect(test.users.get('disabled')?.status).toBe(UserStatus.REMOVING);
  });
  it('never resets a queued deletion timestamp or mutates an account after the permanent claim', async () => {
    const date = new Date('2026-10-01');
    const test = setup([{ ...account('owner'), status: UserStatus.REMOVING, deletedAt: date }]);
    await test.service.softDelete('owner', 'other-admin');
    expect(test.users.get('owner')?.deletedAt).toEqual(date);
    test.users.set('owner', { ...account('owner'), status: UserStatus.DELETED, deletedAt: date });
    await expect(test.service.softDelete('owner', 'other-admin')).rejects.toThrow('Permanent account deletion');
    await expect(test.service.update('owner', { name: 'Changed' })).rejects.toThrow('Permanent account deletion');
    expect(test.user.update).not.toHaveBeenCalled();
  });
  it('revalidates a creating administrator after acquiring the deletion lock', async () => {
    const test = setup([{ ...account('owner', true), status: UserStatus.REMOVING, deletedAt: new Date() }]);
    await expect(test.service.create({ email: 'new@example.com', name: 'New', password: 'password' }, 'owner'))
      .rejects.toThrow('active administrator');
    expect(test.user.create).not.toHaveBeenCalled();
  });
  it('does not schedule legacy administrator-managed removals retroactively', async () => {
    const test = setup([account('owner', true), account('member')]);
    await test.service.softDelete('member', 'owner');
    expect(test.users.get('member')?.status).toBe(UserStatus.REMOVING);
    expect(test.schedule).not.toHaveBeenCalled();
  });
});

describe('account deletion controller authorization', () => {
  it('requires a session and never uses a body-supplied account id', async () => {
    const options = vi.fn(), remove = vi.fn(async () => ({}));
    const controller = new UserController({ deletionOptions: options, deleteOwnAccount: remove } as never, {} as never);
    const key = { user: { id: 'owner' }, apiKey: { id: 'key' } } as never;
    expect(() => controller.deletionOptions(key)).toThrow('API keys');
    expect(() => controller.deleteOwnAccount(key, { confirmationEmail: 'owner@example.com' })).toThrow('API keys');
    const auth = { user: { id: 'owner' }, session: { id: 'session' } } as never;
    const body = { confirmationEmail: 'owner@example.com', userId: 'victim' };
    await controller.deleteOwnAccount(auth, body);
    expect(remove).toHaveBeenCalledWith('owner', body);
    expect(options).not.toHaveBeenCalled();
  });
});
