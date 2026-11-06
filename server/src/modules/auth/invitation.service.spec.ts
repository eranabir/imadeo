import { describe, expect, it, vi } from 'vitest';
import { UserStatus } from '../../db';
import { InvitationService } from './invitation.service';

vi.mock('bcrypt', () => ({ hash: vi.fn(async () => 'password-hash') }));

function setup() {
  let invitation: any = { id: 'invite', email: 'new@example.com', acceptedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000), invitedById: 'inviter', albumId: 'album', role: 'VIEWER' };
  let inviter = { id: 'inviter', status: UserStatus.ACTIVE as UserStatus, deletedAt: null as Date | null };
  let admins = 1;
  let albumAvailable = true;
  let afterLock: (() => void) | undefined;
  const createUser = vi.fn(async ({ data }: any) => ({ id: 'new-user', ...data }));
  const createMembership = vi.fn(async () => ({}));
  const updateInvite = vi.fn(async () => ({}));
  const lock = vi.fn(async () => { afterLock?.(); return 1; });
  const tx = {
    $executeRawUnsafe: lock,
    user: {
      findUnique: vi.fn(async ({ where }: any) => where.id === 'inviter' ? inviter : null),
      count: vi.fn(async () => admins), create: createUser,
    },
    invitation: {
      findUnique: vi.fn(async () => invitation && { ...invitation, invitedBy: inviter }),
      update: updateInvite, deleteMany: vi.fn(), create: vi.fn(),
    },
    albumUser: { create: createMembership },
    album: { findFirst: vi.fn(async () => albumAvailable ? { id: 'album' } : null) },
  };
  const preflight = vi.fn(async () => invitation && { ...invitation });
  const storage = { ensureUserRoot: vi.fn() };
  const mail = { settingsFor: () => ({ publicUrl: 'https://server' }),
    sendAlbumInvite: vi.fn(async () => ({ sent: true })), sendInvitation: vi.fn(async () => ({ sent: true })) };
  const service = new InvitationService({ invitation: { findUnique: preflight },
    $transaction: async (operation: any) => operation(tx) } as never,
    mail as never, {} as never, storage as never);
  return { service, tx, createUser, createMembership, updateInvite, storage, mail, lock,
    state: {
      revoke: () => { invitation = null; },
      accept: () => { invitation.acceptedAt = new Date(); },
      expire: () => { invitation.expiresAt = new Date(0); },
      removeInviter: () => { inviter.status = UserStatus.REMOVING; inviter.deletedAt = new Date(); },
      removeAdmin: () => { admins = 0; },
      removeAlbumOwner: () => { albumAvailable = false; },
      onLock: (operation: () => void) => { afterLock = operation; },
    },
  };
}
const input = { token: 'raw-token', name: 'New user', password: 'password' };

describe('invitation acceptance during account deletion', () => {
  it('validates and consumes the invitation under the shared account lock', async () => {
    const test = setup();
    expect(await test.service.accept(input)).toMatchObject({ id: 'new-user', isAdmin: false, password: 'password-hash' });
    expect(test.lock).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(79218461)');
    expect(test.tx.user.count).toHaveBeenCalledWith({ where: { isAdmin: true, status: UserStatus.ACTIVE, deletedAt: null } });
    expect(test.tx.album.findFirst).toHaveBeenCalledWith({ where: { id: 'album', deletedAt: null,
      owner: { status: UserStatus.ACTIVE, deletedAt: null } }, select: { id: true } });
    expect(test.createMembership).toHaveBeenCalledWith({ data: { albumId: 'album', userId: 'new-user', role: 'VIEWER' } });
    expect(test.updateInvite).toHaveBeenCalledWith({ where: { id: 'invite' }, data: { acceptedAt: expect.any(Date) } });
    expect(test.storage.ensureUserRoot).toHaveBeenCalledWith('new-user');
  });

  it.each(['revoke', 'accept', 'expire'] as const)('rejects a token changed by %s while waiting for the lock', async change => {
    const test = setup();
    test.state.onLock(test.state[change]);
    await expect(test.service.accept(input)).rejects.toThrow();
    expect(test.createUser).not.toHaveBeenCalled();
    expect(test.createMembership).not.toHaveBeenCalled();
  });

  it('does not accept an invitation after its inviter requested account deletion', async () => {
    const test = setup();
    test.state.onLock(test.state.removeInviter);
    await expect(test.service.accept(input)).rejects.toThrow('no longer available');
    expect(test.createUser).not.toHaveBeenCalled();
    expect(test.createMembership).not.toHaveBeenCalled();
  });

  it('does not grant access to a deleting owner’s album through another active inviter', async () => {
    const test = setup();
    test.state.onLock(test.state.removeAlbumOwner);
    await expect(test.service.accept(input)).rejects.toThrow('album invitation is no longer available');
    expect(test.createUser).not.toHaveBeenCalled();
    expect(test.createMembership).not.toHaveBeenCalled();
  });

  it('does not create a regular user after the last administrator leaves', async () => {
    const test = setup();
    test.state.onLock(test.state.removeAdmin);
    await expect(test.service.accept(input)).rejects.toThrow('no active administrator');
    expect(test.createUser).not.toHaveBeenCalled();
  });

  it('preserves passwordless provider invitations', async () => {
    const test = setup();
    expect(await test.service.accept({ token: input.token, name: input.name,
      oauth: { provider: 'apple', subject: 'provider-id' } })).toMatchObject({
      password: '', oauthProvider: 'apple', oauthId: 'provider-id', isAdmin: false,
    });
  });

  it('rejects stale invitation creation requests after the inviter is removed', async () => {
    const test = setup();
    test.state.onLock(test.state.removeInviter);
    await expect(test.service.create({ email: 'new@example.com', invitedById: 'inviter', inviterName: 'Inviter', albumId: 'album' }))
      .rejects.toThrow('cannot create invitations');
    expect(test.tx.invitation.create).not.toHaveBeenCalled();
    expect(test.mail.sendAlbumInvite).not.toHaveBeenCalled();
  });

  it('does not create new album invitations when its owner is inactive', async () => {
    const test = setup();
    test.state.onLock(test.state.removeAlbumOwner);
    await expect(test.service.create({ email: 'new@example.com', invitedById: 'inviter', inviterName: 'Inviter', albumId: 'album' }))
      .rejects.toThrow('no longer accepts invitations');
    expect(test.tx.invitation.create).not.toHaveBeenCalled();
  });
});
