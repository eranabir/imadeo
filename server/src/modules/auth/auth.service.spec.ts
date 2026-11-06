import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

function setup() {
  let row: any = { id: 'session', userId: 'user', tokenHash: AuthService.hashToken('original'),
    expiresAt: new Date(Date.now() + 10000), native: false,
    previousTokenHash: null, refreshRequestId: null,
    user: { status: 'ACTIVE', deletedAt: null } };
  const matches = (where: any) => Object.entries(where).every(([key, value]) => row?.[key] === value);
  const prisma = { session: {
    findFirst: vi.fn(async ({ where }) => row && (where.OR ? where.OR.some(matches) : matches(where)) ? { ...row } : null),
    updateMany: vi.fn(async ({ where, data }) => {
      if (!row || !matches(where)) return { count: 0 };
      row = { ...row, ...data }; return { count: 1 };
    }),
  } };
  const service = new AuthService(prisma as never, { signAsync: vi.fn(async () => 'jwt') } as never,
    { get: (key: string) => key === 'auth.jwtSecret' ? 'test-signing-secret' : key === 'auth.refreshTtl' ? '180d' : false } as never, {} as never);
  return { service, prisma, row: () => row, revoke: () => { row = null; } };
}

describe('refresh rotation recovery', () => {
  it('recovers a lost response without rotating twice or storing raw tokens', async () => {
    const s = setup();
    const first = await s.service.refresh('original', 'same-operation-id', true);
    const retried = await s.service.refresh('original', 'same-operation-id', true);
    expect(retried).toEqual(first);
    expect(s.prisma.session.updateMany).toHaveBeenCalledTimes(1);
    expect(s.row().tokenHash).toBe(AuthService.hashToken(first.refreshToken));
    expect(JSON.stringify(s.row())).not.toContain(first.refreshToken);
    expect(s.row().expiresAt.getUTCFullYear()).toBe(2999);
  });
  it('concurrent identical retries return the same next token', async () => {
    const { service } = setup();
    const results = await Promise.all([service.refresh('original', 'same-operation-id'), service.refresh('original', 'same-operation-id')]);
    expect(results[0]).toEqual(results[1]);
  });
  it('rejects replay with a different operation id and old tokens after another rotation', async () => {
    const { service } = setup();
    const first = await service.refresh('original', 'first-operation-id');
    await expect(service.refresh('original', 'different-operation')).rejects.toThrow('expired');
    await service.refresh(first.refreshToken, 'second-operation-id');
    await expect(service.refresh('original', 'first-operation-id')).rejects.toThrow('expired');
  });
  it('revocation still wins over a pending retry', async () => {
    const s = setup(); await s.service.refresh('original', 'same-operation-id'); s.revoke();
    await expect(s.service.refresh('original', 'same-operation-id')).rejects.toThrow('expired');
  });
  it('keeps ordinary browser sessions expiring and single-use', async () => {
    const s = setup(); await s.service.refresh('original');
    expect(s.row().expiresAt.getUTCFullYear()).toBeLessThan(2999);
    expect(s.row().previousTokenHash).toBeNull();
    await expect(s.service.refresh('original')).rejects.toThrow('expired');
  });
});

describe('registration while administrators are being removed', () => {
  function registration(rows: { id: string; isAdmin: boolean; status: string; deletedAt: Date | null }[], publicRegistration = true,
    onLock?: () => void) {
    const user = {
      findUnique: vi.fn(async () => null),
      count: vi.fn(async (options?: { where?: Record<string, unknown> }) => rows.filter(row =>
        !options?.where || Object.entries(options.where).every(([key, value]) => row[key as keyof typeof row] === value)).length),
      create: vi.fn(async ({ data }: any) => ({ id: 'new-account', ...data })),
    };
    const lock = vi.fn(async () => { onLock?.(); return 1; });
    const tx = { user, $executeRawUnsafe: lock };
    const storage = { ensureUserRoot: vi.fn() };
    const service = new AuthService({ $transaction: async (operation: any) => operation(tx) } as never, {} as never,
      { get: () => publicRegistration } as never, storage as never);
    return { service, user, lock, storage };
  }
  it('preserves first-admin bootstrap with public registration disabled', async () => {
    const test = registration([], false);
    expect(await test.service.register(' Owner@Example.com ', 'password', 'Owner')).toMatchObject({
      isAdmin: true, email: 'owner@example.com',
    });
    expect(test.lock).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(79218461)');
    expect(test.storage.ensureUserRoot).toHaveBeenCalledWith('new-account');
  });
  it('creates ordinary users only while an active administrator remains', async () => {
    const test = registration([{ id: 'admin', isAdmin: true, status: 'ACTIVE', deletedAt: null }]);
    expect(await test.service.register('member@example.com', 'password', 'Member')).toMatchObject({ isAdmin: false });
    expect(test.user.count).toHaveBeenCalledWith({ where: { isAdmin: true, status: 'ACTIVE', deletedAt: null } });
  });
  it('does not create an unmanaged account after the last admin enters removal', async () => {
    const rows = [{ id: 'admin', isAdmin: true, status: 'ACTIVE', deletedAt: null as Date | null }];
    const test = registration(rows, true, () => { rows[0].status = 'REMOVING'; rows[0].deletedAt = new Date(); });
    await expect(test.service.register('member@example.com', 'password', 'Member')).rejects.toThrow('no active administrator');
    expect(test.user.create).not.toHaveBeenCalled();
    expect(test.storage.ensureUserRoot).not.toHaveBeenCalled();
  });
  it('does not let inactive historical accounts claim another first-admin bootstrap', async () => {
    const test = registration([{ id: 'removed', isAdmin: true, status: 'DELETED', deletedAt: new Date() }]);
    await expect(test.service.register('member@example.com', 'password', 'Member')).rejects.toThrow('no active administrator');
    expect(test.user.create).not.toHaveBeenCalled();
  });
});
