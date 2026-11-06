import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mainLibraryAssetWhere } from '../../common/asset-scope';
import { UserStatus, type Prisma } from '../../db';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import type { AppConfig } from '../../config/configuration';
import { MailService } from '../../infra/mail/mail.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import type {
  CreateUserDto,
  DeleteOwnAccountDto,
  UpdatePreferencesDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './user.dto';
import { UserDeletionService, USER_DELETION_GRACE_DAYS } from './user-deletion.service';

export const DEFAULT_PREFERENCES = {
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
    private readonly storage: StorageService,
    private readonly deletions: UserDeletionService,
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

  async create(dto: CreateUserDto, callerId: string) {
    const email = dto.email.toLowerCase().trim();
    const password = await bcrypt.hash(dto.password, 12);
    const user = await this.accountMutation(async tx => {
      // Authentication can precede a concurrent self-deletion. Recheck the
      // creating administrator under the same lock as account removal.
      const caller = await tx.user.findFirst({ where: {
        id: callerId, isAdmin: true, status: UserStatus.ACTIVE, deletedAt: null,
      } });
      if (!caller) throw new ForbiddenException('An active administrator is required to create an account.');
      if (await tx.user.findUnique({ where: { email } })) {
        throw new BadRequestException('An account with that email already exists');
      }
      return tx.user.create({
        data: {
          email, name: dto.name.trim(), password, isAdmin: dto.isAdmin ?? false,
          quotaSizeInBytes: dto.quotaSizeInBytes ?? null,
          storageLabel: dto.storageLabel?.trim() || null,
          shouldChangePassword: dto.shouldChangePassword ?? true,
          preferences: DEFAULT_PREFERENCES,
        },
        select: PUBLIC_FIELDS,
      });
    });
    await this.storage.ensureUserRoot(user.id);
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    const password = dto.password ? await bcrypt.hash(dto.password, 12) : undefined;
    return this.accountMutation(async tx => {
      const current = await tx.user.findUniqueOrThrow({ where: { id } });
      if (current.status === UserStatus.DELETED) throw new BadRequestException('Permanent account deletion has already started.');
      if (current.isAdmin && dto.isAdmin === false && current.status === UserStatus.ACTIVE && !current.deletedAt) {
        const admins = await tx.user.count({ where: { isAdmin: true, status: UserStatus.ACTIVE, deletedAt: null } });
        if (admins <= 1) throw new ForbiddenException('The last administrator cannot be demoted. Make another account an administrator first.');
      }
      return tx.user.update({
        where: { id },
        data: {
          email: dto.email?.toLowerCase().trim(), name: dto.name?.trim(), password,
          isAdmin: dto.isAdmin, quotaSizeInBytes: dto.quotaSizeInBytes,
          storageLabel: dto.storageLabel?.trim() || undefined,
          shouldChangePassword: dto.shouldChangePassword,
        },
        select: PUBLIC_FIELDS,
      });
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

  /** Serialize role changes and removal with first-admin setup and purge claims. */
  private accountMutation<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(79218461)');
      return work(tx);
    }, { timeout: 15_000 });
  }

  async deletionOptions(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const admins = user.isAdmin ? await this.prisma.user.count({
      where: { isAdmin: true, status: UserStatus.ACTIVE, deletedAt: null },
    }) : 0;
    const others = await this.prisma.user.findMany({
      where: { id: { not: userId }, status: UserStatus.ACTIVE, deletedAt: null },
      select: { id: true, name: true, email: true }, orderBy: { name: 'asc' },
    });
    const requiresSuccessor = user.isAdmin && admins <= 1 && others.length > 0;
    const otherAccounts = await this.prisma.user.count({ where: { id: { not: userId } } });
    return {
      gracePeriodDays: USER_DELETION_GRACE_DAYS,
      hasPassword: user.password.length > 0,
      requiresSuccessor,
      willEmptyServer: otherAccounts === 0,
      leavesServerWithoutAdmin: user.isAdmin && admins <= 1 && others.length === 0 && otherAccounts > 0,
      successors: requiresSuccessor ? others : [],
    };
  }

  async deleteOwnAccount(userId: string, dto: DeleteOwnAccountDto) {
    const verified = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (verified.password && (!dto.currentPassword || !(await bcrypt.compare(dto.currentPassword, verified.password)))) {
      throw new BadRequestException('Current password is incorrect.');
    }
    return this.accountMutation(async tx => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.status !== UserStatus.ACTIVE || user.deletedAt) throw new BadRequestException('This account is already being removed.');
      if (user.password !== verified.password) throw new BadRequestException('Your password changed. Enter the current password and try again.');
      if (dto.confirmationEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
        throw new BadRequestException('Type your account email address to confirm deletion.');
      }
      if (dto.successorId && !user.isAdmin) throw new ForbiddenException('Only an administrator can transfer administration.');
      const admins = user.isAdmin ? await tx.user.count({
        where: { isAdmin: true, status: UserStatus.ACTIVE, deletedAt: null },
      }) : 0;
      const otherUsers = await tx.user.count({ where: {
        id: { not: userId }, status: UserStatus.ACTIVE, deletedAt: null,
      } });
      if (user.isAdmin && admins <= 1 && otherUsers > 0 && !dto.successorId) {
        throw new BadRequestException({ code: 'ADMIN_SUCCESSOR_REQUIRED',
          message: 'Choose another account to become administrator before deleting yours.' });
      }
      if (user.isAdmin && admins <= 1 && otherUsers === 0 && !dto.successorId) {
        const otherAccounts = await tx.user.count({ where: { id: { not: userId } } });
        if (otherAccounts > 0 && dto.acknowledgeServerLockout !== true) {
          throw new BadRequestException({ code: 'SERVER_LOCKOUT_ACKNOWLEDGEMENT_REQUIRED',
            message: 'Disabled accounts remain on this server. Confirm that deleting your account leaves the server without an administrator and does not reopen setup.' });
        }
      }
      if (dto.successorId) {
        const successor = await tx.user.findFirst({ where: {
          id: dto.successorId, NOT: { id: userId }, status: UserStatus.ACTIVE, deletedAt: null,
        } });
        if (!successor) throw new BadRequestException('Choose an active account other than your own as administrator.');
      }
      const deletedAt = new Date();
      // Queue first: a Redis failure rolls back this request. If a later DB
      // commit fails, the timestamp-guarded job safely ignores the orphan.
      await this.deletions.schedule(userId, deletedAt);
      if (dto.successorId) await tx.user.update({ where: { id: dto.successorId }, data: { isAdmin: true } });
      await tx.user.update({ where: { id: userId }, data: { status: UserStatus.REMOVING, deletedAt } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.apiKey.deleteMany({ where: { userId } });
      await tx.sharedLink.deleteMany({ where: { userId } });
      await tx.invitation.deleteMany({ where: { OR: [{ invitedById: userId }, { album: { ownerId: userId } }] } });
      await tx.assetUser.deleteMany({ where: { asset: { ownerId: userId } } });
      await tx.albumUser.deleteMany({ where: { album: { ownerId: userId } } });
      await tx.folderUser.deleteMany({ where: { folder: { ownerId: userId } } });
      await tx.partner.deleteMany({ where: { OR: [{ sharedById: userId }, { sharedWithId: userId }] } });
      return {
        deletedAt: deletedAt.toISOString(),
        deleteAfter: new Date(deletedAt.getTime() + USER_DELETION_GRACE_DAYS * 86_400_000).toISOString(),
        gracePeriodDays: USER_DELETION_GRACE_DAYS,
      };
    });
  }

  /** Administrator-managed removal remains separate from self-service requests. */
  async softDelete(id: string, callerId: string) {
    if (id === callerId) throw new BadRequestException('Use the account deletion option to delete your own account.');
    return this.accountMutation(async tx => {
      const target = await tx.user.findUniqueOrThrow({ where: { id } });
      if (target.status === UserStatus.DELETED) throw new BadRequestException('Permanent account deletion has already started.');
      if (target.status === UserStatus.REMOVING) return tx.user.findUniqueOrThrow({ where: { id }, select: PUBLIC_FIELDS });
      if (target.isAdmin && target.status === UserStatus.ACTIVE && !target.deletedAt) {
        const admins = await tx.user.count({ where: { isAdmin: true, status: UserStatus.ACTIVE, deletedAt: null } });
        if (admins <= 1) throw new ForbiddenException('The last administrator cannot be removed');
      }
      return tx.user.update({ where: { id }, data: { status: UserStatus.REMOVING, deletedAt: new Date() }, select: PUBLIC_FIELDS });
    });
  }

  restore(id: string) {
    return this.accountMutation(async tx => {
      const target = await tx.user.findUniqueOrThrow({ where: { id } });
      if (target.status === UserStatus.DELETED) throw new BadRequestException('Permanent account deletion has already started.');
      return tx.user.update({ where: { id }, data: { status: UserStatus.ACTIVE, deletedAt: null }, select: PUBLIC_FIELDS });
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
      this.prisma.asset.count({ where: { ...mainLibraryAssetWhere(userId), type: 'IMAGE' } }),
      this.prisma.asset.count({ where: { ...mainLibraryAssetWhere(userId), type: 'VIDEO' } }),
      this.prisma.asset.aggregate({
        where: { ownerId: userId, deletedAt: null },
        _sum: { fileSizeInByte: true },
      }),
    ]);
    return { images, videos, total: images + videos, usageInBytes: usage._sum.fileSizeInByte ?? 0n };
  }
}
