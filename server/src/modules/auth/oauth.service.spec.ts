import { describe, expect, it, vi } from 'vitest';
import { OAuthService } from './oauth.service';

const profile = { subject: 'provider-subject', email: 'member@example.com', name: 'Member', emailVerified: true };
function setup(rows: { id: string; isAdmin: boolean; status: string; deletedAt: Date | null }[], onLock?: () => void) {
  const create = vi.fn(async ({ data }: any) => ({ id: 'new-account', ...data }));
  const user = {
    count: vi.fn(async (options?: { where?: Record<string, unknown> }) => rows.filter(row =>
      !options?.where || Object.entries(options.where).every(([key, value]) => row[key as keyof typeof row] === value)).length),
    create,
  };
  const lock = vi.fn(async () => { onLock?.(); return 1; });
  const storage = { ensureUserRoot: vi.fn() };
  const service = new OAuthService({ user: { findUnique: vi.fn(async () => null) },
    $transaction: async (operation: any) => operation({ user, $executeRawUnsafe: lock }) } as never,
    {} as never, { get: () => true } as never, {} as never, storage as never);
  const resolve = () => (service as unknown as { resolveUser: (provider: 'google', value: typeof profile) => Promise<{ isAdmin: boolean }> })
    .resolveUser('google', profile);
  return { resolve, create, lock, user, storage };
}

describe('OAuth new-account administration safety', () => {
  it('preserves a truly empty server first-administrator bootstrap', async () => {
    const test = setup([]);
    expect(await test.resolve()).toMatchObject({ isAdmin: true });
    expect(test.lock).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(79218461)');
  });
  it('creates regular accounts when another active administrator remains', async () => {
    const test = setup([{ id: 'admin', isAdmin: true, status: 'ACTIVE', deletedAt: null }]);
    expect(await test.resolve()).toMatchObject({ isAdmin: false });
    expect(test.storage.ensureUserRoot).toHaveBeenCalledWith('new-account');
  });
  it('rechecks administrator availability after waiting for the account mutation lock', async () => {
    const rows = [{ id: 'admin', isAdmin: true, status: 'ACTIVE', deletedAt: null as Date | null }];
    const test = setup(rows, () => { rows[0].status = 'REMOVING'; rows[0].deletedAt = new Date(); });
    await expect(test.resolve()).rejects.toThrow('no active administrator');
    expect(test.create).not.toHaveBeenCalled();
    expect(test.storage.ensureUserRoot).not.toHaveBeenCalled();
  });
  it('does not bootstrap over retained historical accounts', async () => {
    const test = setup([{ id: 'removed', isAdmin: true, status: 'DELETED', deletedAt: new Date() }]);
    await expect(test.resolve()).rejects.toThrow('no active administrator');
    expect(test.create).not.toHaveBeenCalled();
  });
});
