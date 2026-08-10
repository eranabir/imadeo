import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AppConfig } from '../../config/configuration';

/**
 * The vault protects "locked" folders and albums.
 *
 * A random 32-byte content key is generated once per user. It is wrapped with a
 * key derived from the server's VAULT_MASTER_KEY *and* the user's private password, so
 * neither a database dump nor the server config alone is enough to unwrap it.
 * Unlocking is per-session and time limited.
 */
@Injectable()
export class VaultService {
  /**
   * Unwrapped content keys, held in memory only and keyed by session.
   *
   * This is what makes the vault meaningful at rest: the key exists nowhere on
   * disk in usable form, so a stolen database and a stolen .env together still
   * cannot decrypt vault files without someone entering the private password. A restart
   * clears every key, and the vault relocks.
   */
  private readonly unlockedKeys = new Map<string, { key: Buffer; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** The in-memory content key for a session, or null when locked or lapsed. */
  getContentKey(sessionId: string | undefined): Buffer | null {
    if (!sessionId) return null;

    const entry = this.unlockedKeys.get(sessionId);
    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      this.unlockedKeys.delete(sessionId);
      return null;
    }
    return entry.key;
  }

  private deriveKek(pin: string, salt: Buffer): Buffer {
    const master = this.config.get('auth.vaultMasterKey', { infer: true });
    if (!master) {
      throw new BadRequestException('VAULT_MASTER_KEY is not configured on this server');
    }
    return scryptSync(`${master}:${pin}`, salt, 32, { N: 16384, r: 8, p: 1 });
  }

  private wrap(contentKey: Buffer, pin: string): string {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.deriveKek(pin, salt), iv);
    const sealed = Buffer.concat([cipher.update(contentKey), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [salt, iv, tag, sealed].map((b) => b.toString('base64')).join('.');
  }

  private unwrap(wrapped: string, pin: string): Buffer {
    const [salt, iv, tag, sealed] = wrapped.split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.deriveKek(pin, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(sealed), decipher.final()]);
  }

  async status(userId: string, sessionId?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { vaultPinHash: true },
    });
    const session = sessionId
      ? await this.prisma.session.findUnique({
          where: { id: sessionId },
          select: { vaultUnlockedUntil: true },
        })
      : null;

    const until = session?.vaultUnlockedUntil ?? null;
    return {
      isConfigured: Boolean(user.vaultPinHash),
      isUnlocked: Boolean(until && until.getTime() > Date.now()),
      unlockedUntil: until,
    };
  }

  /** First-time setup. Fails if a private password already exists — use `changePin` instead. */
  async setPin(userId: string, pin: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.vaultPinHash) {
      throw new BadRequestException('A password for locked folders is already set');
    }

    const contentKey = randomBytes(32);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        vaultPinHash: await bcrypt.hash(pin, 12),
        vaultWrappedKey: this.wrap(contentKey, pin),
      },
    });
  }

  async changePin(userId: string, currentPin: string, newPin: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.vaultPinHash || !user.vaultWrappedKey) {
      throw new BadRequestException('No password for locked folders has been set');
    }
    if (!(await bcrypt.compare(currentPin, user.vaultPinHash))) {
      throw new ForbiddenException('Incorrect password for locked folders');
    }

    // Re-wrap the same content key so already-stored data stays readable.
    const contentKey = this.unwrap(user.vaultWrappedKey, currentPin);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        vaultPinHash: await bcrypt.hash(newPin, 12),
        vaultWrappedKey: this.wrap(contentKey, newPin),
      },
    });

    // Force every device to re-authenticate against the vault.
    await this.prisma.session.updateMany({
      where: { userId },
      data: { vaultUnlockedUntil: null },
    });
  }

  async unlock(userId: string, sessionId: string, pin: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.vaultPinHash) {
      throw new BadRequestException('No password for locked folders has been set');
    }
    if (!(await bcrypt.compare(pin, user.vaultPinHash))) {
      throw new ForbiddenException('Incorrect password for locked folders');
    }

    const minutes = this.config.get('auth.vaultUnlockMinutes', { infer: true });
    const until = new Date(Date.now() + minutes * 60_000);

    // Unwrap once, here, and keep the key only in memory for this session.
    this.unlockedKeys.set(sessionId, {
      key: this.unwrap(user.vaultWrappedKey!, pin),
      expiresAt: until.getTime(),
    });

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { vaultUnlockedUntil: until },
    });

    return { isUnlocked: true, unlockedUntil: until };
  }

  async lock(userId: string, sessionId?: string) {
    if (sessionId) {
      this.unlockedKeys.delete(sessionId);
    } else {
      // Locking everywhere means dropping every key this user holds.
      const sessions = await this.prisma.session.findMany({
        where: { userId },
        select: { id: true },
      });
      for (const session of sessions) this.unlockedKeys.delete(session.id);
    }

    await this.prisma.session.updateMany({
      where: { userId, ...(sessionId ? { id: sessionId } : {}) },
      data: { vaultUnlockedUntil: null },
    });
    return { isUnlocked: false, unlockedUntil: null };
  }
}
