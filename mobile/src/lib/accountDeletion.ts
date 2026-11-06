import { ApiError, request } from './api';
import { cancelBackup } from './backup';
import { sessionGeneration } from './auth';

export interface AccountDeletionOptions {
  gracePeriodDays: number;
  hasPassword: boolean;
  requiresSuccessor: boolean;
  willEmptyServer: boolean;
  leavesServerWithoutAdmin: boolean;
  successors: { id: string; name: string; email: string }[];
}
export interface AccountDeletionRequest {
  confirmationEmail: string;
  acknowledgeServerLockout?: boolean;
  currentPassword?: string;
  successorId?: string;
}
export interface AccountDeletionReceipt {
  deletedAt: string;
  deleteAfter: string;
  gracePeriodDays: number;
}

const compatibleError = (cause: unknown): Error =>
  cause instanceof ApiError && [404, 405, 501].includes(cause.status)
    ? new Error('This server version does not support account deletion in the app. Update your Imadeo server, then try again.')
    : cause instanceof Error ? cause : new Error('Could not request account deletion. Please try again.');

export async function accountDeletionOptions(serverUrl: string): Promise<AccountDeletionOptions> {
  try {
    return await request<AccountDeletionOptions>(serverUrl, '/users/me/deletion');
  } catch (cause) { throw compatibleError(cause); }
}

export async function deleteOwnAccount(serverUrl: string, body: AccountDeletionRequest): Promise<AccountDeletionReceipt> {
  const generation = sessionGeneration();
  await cancelBackup();
  if (generation !== sessionGeneration()) throw new Error('The selected session changed.');
  try {
    const receipt = await request<AccountDeletionReceipt>(serverUrl, '/users/me', {
      method: 'DELETE', body: JSON.stringify(body),
    });
    if (generation !== sessionGeneration()) throw new Error('The selected session changed.');
    return receipt;
  } catch (cause) { throw compatibleError(cause); }
}
