import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AuthDto } from './auth.types';
import { assertVaultUnlocked } from './auth.guard';

const auth = (vaultUnlockedUntil: Date | null): AuthDto => ({
  user: {
    id: 'user-id',
    email: 'user@example.com',
    name: 'User',
    isAdmin: false,
    quotaSizeInBytes: null,
    quotaUsageInBytes: 0n,
  },
  session: { id: 'session-id', vaultUnlockedUntil },
});

describe('assertVaultUnlocked', () => {
  it('allows a session whose Locked access is still active', () => {
    expect(() => assertVaultUnlocked(auth(new Date(Date.now() + 60_000)))).not.toThrow();
  });

  it('rejects a locked or expired session with the vault error code', () => {
    for (const until of [null, new Date(Date.now() - 1)]) {
      try {
        assertVaultUnlocked(auth(until));
        throw new Error('Expected Locked access to be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'VAULT_LOCKED' });
      }
    }
  });
});
