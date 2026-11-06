import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn(), cancel: vi.fn(), generation: 0 }));
vi.mock('./api', () => ({ request: mock.request,
  ApiError: class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } },
}));
vi.mock('./backup', () => ({ cancelBackup: mock.cancel }));
vi.mock('./auth', () => ({ sessionGeneration: () => mock.generation }));
import { ApiError } from './api';
import { accountDeletionOptions, deleteOwnAccount } from './accountDeletion';
beforeEach(() => { vi.resetAllMocks(); mock.generation = 0; mock.cancel.mockResolvedValue(undefined); });
describe('account deletion transport', () => {
  it('loads deletion requirements without mutating the account', async () => {
    const options = { gracePeriodDays: 30, requiresSuccessor: false, hasPassword: true, willEmptyServer: true, leavesServerWithoutAdmin: false, successors: [] };
    mock.request.mockResolvedValue(options);
    expect(await accountDeletionOptions('https://server')).toEqual(options);
    expect(mock.request).toHaveBeenCalledExactlyOnceWith('https://server', '/users/me/deletion');
    expect(mock.cancel).not.toHaveBeenCalled();
  });
  it('stops backup before sending a single self-account request', async () => {
    const body = { confirmationEmail: 'owner@example.com', currentPassword: 'secret', successorId: 'successor' };
    const receipt = { deletedAt: '2026-11-06', deleteAfter: '2026-12-06', gracePeriodDays: 30 };
    mock.request.mockResolvedValue(receipt);
    expect(await deleteOwnAccount('https://server', body)).toEqual(receipt);
    expect(mock.cancel.mock.invocationCallOrder[0]).toBeLessThan(mock.request.mock.invocationCallOrder[0]);
    expect(mock.request).toHaveBeenCalledExactlyOnceWith('https://server', '/users/me', { method: 'DELETE', body: JSON.stringify(body) });
  });
  it.each([404, 405, 501])('gives a clear server-update instruction for older API response %s', async status => {
    mock.request.mockRejectedValue(new ApiError('Not found', status));
    await expect(accountDeletionOptions('https://server')).rejects.toThrow('Update your Imadeo server');
    await expect(deleteOwnAccount('https://server', { confirmationEmail: 'owner@example.com' })).rejects.toThrow('Update your Imadeo server');
  });
  it('never sends deletion if the selected session changes while backup is stopping', async () => {
    mock.cancel.mockImplementation(async () => { mock.generation++; });
    await expect(deleteOwnAccount('https://server', { confirmationEmail: 'owner@example.com' })).rejects.toThrow('selected session changed');
    expect(mock.request).not.toHaveBeenCalled();
  });
  it('does not return success to a different account after the response arrives', async () => {
    mock.request.mockImplementation(async () => { mock.generation++; return { gracePeriodDays: 30 }; });
    await expect(deleteOwnAccount('https://server', { confirmationEmail: 'owner@example.com' })).rejects.toThrow('selected session changed');
  });
  it('preserves wrong-password and administrator-transfer errors for correction', async () => {
    const cause = new ApiError('Choose a successor', 400, 'ADMIN_SUCCESSOR_REQUIRED');
    mock.request.mockRejectedValue(cause);
    await expect(deleteOwnAccount('https://server', { confirmationEmail: 'owner@example.com' })).rejects.toBe(cause);
    expect(mock.request).toHaveBeenCalledOnce();
  });
});
