import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '../../db';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import type { AppConfig } from '../../config/configuration';
import { MailService } from '../../infra/mail/mail.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type {
  CreateUserDto,
  UpdatePreferencesDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './user.dto';

const DEFAULT_PREFERENCES = {
  theme: 'system',
  tileSize: 235,
  showAssetsInSubfolders: true,
  timelineLayout: 'justified',
  autoplayVideos: true,
  loopVideos: false,
  videoQuality: 'transcoded',
  showMemories: true,
  locale: 'en',
};

const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  isAdmin: true,
  status: true,
  storageLabel: true,
  profileImagePath: true,
  quotaSizeInBytes: true,
  quotaUsageInBytes: true,
  shouldChangePassword: true,
  oauthProvider: true,
  preferences: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

/** How long a confirmation link stays usable. */
const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      // The hash itself never leaves the server; only whether one exists, which
      // is what the UI needs to know before offering to disconnect a provider.
      select: { ...PUBLIC_FIELDS, password: true },
    });
    const { password, ...rest } = user;

    return {
      ...rest,
      hasPassword: password.length > 0,
      preferences: { ...DEFAULT_PREFERENCES, ...(user.preferences as object) },
    };
  }

  /** Everyone the caller may share with — name and avatar only. */
  listPeers(userId: string) {
    return this.prisma.user.findMany({
      where: { id: { not: userId }, status: UserStatus.ACTIVE, deletedAt: null },
      select: { id: true, email: true, name: true, profileImagePath: true },
      orderBy: { name: 'asc' },
    });
  }

  listAll() {
    return this.prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'asc' } });
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto) {
    const email = dto.email.toLowerCase().trim();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException('An account with that email already exists');
    }

    return this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        password: await bcrypt.hash(dto.password, 12),
        isAdmin: dto.isAdmin ?? false,
        quotaSizeInBytes: dto.quotaSizeInBytes ?? null,
        storageLabel: dto.storageLabel?.trim() || null,
        shouldChangePassword: dto.shouldChangePassword ?? true,
        preferences: DEFAULT_PREFERENCES,
      },
      select: PUBLIC_FIELDS,
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.get(id);

    return this.prisma.user.update({
      where: { id },
      data: {
        email: dto.email?.toLowerCase().trim(),
        name: dto.name?.trim(),
        password: dto.password ? await bcrypt.hash(dto.password, 12) : undefined,
        isAdmin: dto.isAdmin,
        quotaSizeInBytes: dto.quotaSizeInBytes,
        storageLabel: dto.storageLabel?.trim() || undefined,
        shouldChangePassword: dto.shouldChangePassword,
      },
      select: PUBLIC_FIELDS,
    });
  }

  /**
   * Self-service edit of name and email. Cannot touch role, quota or password.
   *
   * The name is applied at once, but a new email only starts a verification
   * round trip — see `requestEmailChange`. Changing the login identifier on the
   * strength of one form post would let a borrowed session move an account to
   * an address its owner does not control.
   */
  async updateProfile(id: string, dto: UpdateProfileDto) {
    if (dto.name !== undefined) {
      await this.prisma.user.update({ where: { id }, data: { name: dto.name.trim() } });
    }

    const email = dto.email?.toLowerCase().trim();
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { email: true },
    });

    const pendingEmail = email && email !== current.email ? email : null;
    const verification = pendingEmail ? await this.requestEmailChange(id, pendingEmail) : null;

    // Returned through `me` so the client gets exactly the shape it already
    // holds — including hasPassword, which a bare update would drop.
    return { ...(await this.me(id)), emailChange: verification };
  }

  /**
   * Starts an email change: stores a hashed token and mails the confirmation
   * link to the *new* address. Nothing about the account moves until that link
   * is opened.
   */
  async requestEmailChange(userId: string, newEmail: string) {
    const taken = await this.prisma.user.findFirst({
      where: { email: newEmail, id: { not: userId } },
      select: { id: true },
    });
    if (taken) throw new BadRequestException('That email is already in use');

    // Only one change can be in flight; asking again replaces the last link.
    await this.prisma.emailChange.deleteMany({ where: { userId } });

    const token = randomBytes(32).toString('base64url');
    await this.prisma.emailChange.create({
      data: {
        userId,
        newEmail,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
      },
    });

    const url = `${this.mail.settingsFor().publicUrl}/settings?section=account&confirmEmail=${token}`;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true },
    });

    const { sent } = await this.mail.sendEmailChangeConfirmation({
      to: newEmail,
      name: user.name,
      url,
    });

    return {
      pendingEmail: newEmail,
      sent,
      // Self-hosted servers very often have no mail relay. Rather than leaving
      // the change permanently stuck, hand the link back for the person who is
      // already authenticated to open — the same approach album invites take.
      url: sent ? undefined : url,
    };
  }

  /** Completes a change. The token is single use and expires. */
  async confirmEmailChange(userId: string, token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const request = await this.prisma.emailChange.findUnique({ where: { tokenHash } });

    if (!request || request.userId !== userId) {
      throw new BadRequestException('That confirmation link is not valid');
    }
    if (request.expiresAt < new Date()) {
      await this.prisma.emailChange.delete({ where: { id: request.id } });
      throw new BadRequestException('That confirmation link has expired. Please try again.');
    }

    // Re-checked here: the address may have been claimed while the link sat in
    // an inbox.
    const taken = await this.prisma.user.findFirst({
      where: { email: request.newEmail, id: { not: userId } },
      select: { id: true },
    });
    if (taken) {
      await this.prisma.emailChange.delete({ where: { id: request.id } });
      throw new BadRequestException('That email has since been taken by another account');
    }

    await this.prisma.user.update({ where: { id: userId }, data: { email: request.newEmail } });
    await this.prisma.emailChange.delete({ where: { id: request.id } });

    return this.me(userId);
  }

  /** The change awaiting confirmation, if any, so the UI can show its state. */
  async pendingEmailChange(userId: string) {
    const request = await this.prisma.emailChange.findFirst({
      where: { userId, expiresAt: { gt: new Date() } },
      select: { newEmail: true, expiresAt: true },
    });
    return request ?? null;
  }

  async cancelEmailChange(userId: string) {
    await this.prisma.emailChange.deleteMany({ where: { userId } });
    return { cancelled: true };
  }

  async updatePreferences(id: string, dto: UpdatePreferencesDto) {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { preferences: true },
    });
    const preferences = {
      ...DEFAULT_PREFERENCES,
      ...(current.preferences as object),
      // Drop undefined so a partial update does not blank existing values.
      ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)),
    };

    await this.prisma.user.update({ where: { id }, data: { preferences } });
    return preferences;
  }

  /**
   * Soft delete. The account is queued for removal and its content is purged by
   * the `user-deletion` job once the grace period elapses.
   */
  async softDelete(id: string, callerId: string) {
    if (id === callerId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (target.isAdmin) {
      const admins = await this.prisma.user.count({ where: { isAdmin: true, deletedAt: null } });
      if (admins <= 1) throw new ForbiddenException('The last administrator cannot be removed');
    }

    return this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.REMOVING, deletedAt: new Date() },
      select: PUBLIC_FIELDS,
    });
  }

  restore(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
      select: PUBLIC_FIELDS,
    });
  }

  /** Recomputes quota usage from the assets actually on disk. */
  async recalculateUsage(userId: string) {
    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM("fileSizeInByte"), 0)::bigint AS total
      FROM assets WHERE "ownerId" = ${userId}::uuid AND "deletedAt" IS NULL
    `;
    await this.prisma.user.update({
      where: { id: userId },
      data: { quotaUsageInBytes: total },
    });
    return total;
  }

  async assertQuota(userId: string, incomingBytes: number) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { quotaSizeInBytes: true, quotaUsageInBytes: true },
    });
    if (user.quotaSizeInBytes === null) return;
    if (user.quotaUsageInBytes + BigInt(incomingBytes) > user.quotaSizeInBytes) {
      throw new BadRequestException('Storage quota exceeded');
    }
  }

  /**
   * Real disk numbers for the volume the library lives on, so the UI can show
   * how much room is actually left rather than only what this account has used.
   */
  async diskUsage(mediaRoot: string) {
    try {
      const info = await statfs(mediaRoot);
      const total = info.blocks * info.bsize;
      // `bavail` is what an unprivileged process may use; `bfree` includes the
      // reserve only root can touch, which would overstate the free space.
      const available = info.bavail * info.bsize;
      return {
        totalBytes: total,
        availableBytes: available,
        usedBytes: total - available,
      };
    } catch {
      return { totalBytes: null, availableBytes: null, usedBytes: null };
    }
  }

  async statistics(userId: string) {
    const [images, videos, usage] = await Promise.all([
      this.prisma.asset.count({ where: { ownerId: userId, type: 'IMAGE', deletedAt: null } }),
      this.prisma.asset.count({ where: { ownerId: userId, type: 'VIDEO', deletedAt: null } }),
      this.prisma.asset.aggregate({
        where: { ownerId: userId, deletedAt: null },
        _sum: { fileSizeInByte: true },
      }),
    ]);
    return { images, videos, total: images + videos, usageInBytes: usage._sum.fileSizeInByte ?? 0n };
  }
}
