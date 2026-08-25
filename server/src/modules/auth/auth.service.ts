import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Permission, UserStatus } from '../../db';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import type { AuthDto } from '../../common/auth.types';
import type { AppConfig } from '../../config/configuration';
import { DEFAULT_PREFERENCES } from '../user/user.service';

const SALT_ROUNDS = 12;

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
    shouldChangePassword: boolean;
    profileImagePath: string;
    quotaSizeInBytes: bigint | null;
    quotaUsageInBytes: bigint;
    oauthProvider: string | null;
    hasPassword: boolean;
    preferences: typeof DEFAULT_PREFERENCES;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly storage: StorageService,
  ) {}

  static hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  // -- credentials ----------------------------------------------------------

  async login(
    email: string,
    password: string,
    device: { type: string; os: string; ip: string },
  ): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Always run a hash comparison so a missing account and a wrong password
    // take the same amount of time.
    const hash = user?.password || '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const matches = await bcrypt.compare(password, hash);

    if (!user || !matches || user.status !== UserStatus.ACTIVE || user.deletedAt) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    return this.issueSession(user.id, device);
  }

  /**
   * Whether an account can be created without an invitation.
   *
   * Open registration exists for exactly one moment: the empty server, so the
   * first administrator can be created. After that the only ways in are an
   * invitation or an administrator adding the account, which is what keeps a
   * self-hosted instance from becoming a public sign-up page.
   *
   * PUBLIC_REGISTRATION can reopen it deliberately for an instance that wants
   * that, but it is off by default.
   */
  async canRegister() {
    const users = await this.prisma.user.count();
    const isFirstUser = users === 0;

    return {
      allowed: isFirstUser || this.config.get('auth.publicRegistration', { infer: true }),
      isFirstUser,
      /// Whether anyone can still become the owner of this server.
      needsSetup: isFirstUser,
    };
  }

  async register(email: string, password: string, name: string) {
    const normalised = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      // Only one request may decide who owns a newly installed server. A plain
      // count followed by create allows two simultaneous first sign-ups to both
      // become administrators.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(79218461)');

      const existing = await tx.user.findUnique({ where: { email: normalised } });
      if (existing) {
        throw new BadRequestException('An account with that email already exists');
      }

      const isFirstUser = (await tx.user.count()) === 0;
      if (!isFirstUser && !this.config.get('auth.publicRegistration', { infer: true })) {
        throw new BadRequestException('This server is invitation only. Ask an administrator to invite you.');
      }

      return tx.user.create({
        data: {
          email: normalised,
          name: name.trim() || normalised.split('@')[0],
          password: passwordHash,
          isAdmin: isFirstUser,
          shouldChangePassword: false,
          storageLabel: this.storageLabelFor(normalised),
        },
      });
    });
    await this.storage.ensureUserRoot(user.id);
    return user;
  }

  /** A stable, filesystem-safe directory name derived from the email. */
  private storageLabelFor(email: string) {
    const base = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const suffix = createHash('sha1').update(email).digest('hex').slice(0, 6);
    return `${base || 'user'}-${suffix}`;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: await bcrypt.hash(newPassword, SALT_ROUNDS),
        shouldChangePassword: false,
      },
    });

    // Any other device holding a refresh token is now stale.
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  /** Mints a session for an account that authenticated through an identity provider. */
  loginWithUserId(userId: string, device: { type: string; os: string; ip: string }) {
    return this.issueSession(userId, device);
  }

  // -- sessions -------------------------------------------------------------

  private async issueSession(
    userId: string,
    device: { type: string; os: string; ip: string },
  ): Promise<LoginResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const refreshToken = randomBytes(48).toString('base64url');

    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: AuthService.hashToken(refreshToken),
        deviceType: device.type,
        deviceOS: device.os,
        ipAddress: device.ip,
        // The guard checks the session row too, so a non-expiring token still
        // needs a session that outlives it.
        expiresAt: this.sessionExpiry(),
      },
    });

    return {
      accessToken: await this.signAccessToken(userId, session.id),
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        shouldChangePassword: user.shouldChangePassword,
        profileImagePath: user.profileImagePath,
        quotaSizeInBytes: user.quotaSizeInBytes,
        quotaUsageInBytes: user.quotaUsageInBytes,
        oauthProvider: user.oauthProvider,
        hasPassword: user.password.length > 0,
        preferences: {
          ...DEFAULT_PREFERENCES,
          ...(user.preferences as Partial<typeof DEFAULT_PREFERENCES>),
        },
      },
    };
  }

  private signAccessToken(userId: string, sessionId: string) {
    // In development the token is minted without an `exp` claim so a working
    // session never lapses. Never reachable in production — see the config.
    const persistent = this.config.get('auth.persistentSession', { infer: true });

    return this.jwt.signAsync(
      { sub: userId, sid: sessionId },
      {
        secret: this.config.get('auth.jwtSecret', { infer: true }),
        ...(persistent
          ? {}
          : { expiresIn: this.config.get('auth.accessTtl', { infer: true }) }),
      },
    );
  }

  /** Exchanges a refresh token for a new access token, rotating the refresh token. */
  async refresh(refreshToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: AuthService.hashToken(refreshToken) },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }
    if (session.user.status !== UserStatus.ACTIVE || session.user.deletedAt) {
      throw new UnauthorizedException('Account is not active');
    }

    const nextToken = randomBytes(48).toString('base64url');

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        tokenHash: AuthService.hashToken(nextToken),
        expiresAt: this.sessionExpiry(),
      },
    });

    return {
      accessToken: await this.signAccessToken(session.userId, session.id),
      refreshToken: nextToken,
    };
  }

  async logout(sessionId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  async logoutAll(userId: string, exceptSessionId?: string) {
    await this.prisma.session.deleteMany({
      where: { userId, id: exceptSessionId ? { not: exceptSessionId } : undefined },
    });
  }

  listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId },
      select: {
        id: true,
        deviceType: true,
        deviceOS: true,
        ipAddress: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // -- credential validation used by the guard ------------------------------

  async validateAccessToken(token: string): Promise<AuthDto | null> {
    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get('auth.jwtSecret', { infer: true }),
      });
    } catch {
      return null;
    }

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) return null;
    if (session.user.status !== UserStatus.ACTIVE || session.user.deletedAt) return null;

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        isAdmin: session.user.isAdmin,
        quotaSizeInBytes: session.user.quotaSizeInBytes,
        quotaUsageInBytes: session.user.quotaUsageInBytes,
      },
      session: { id: session.id, vaultUnlockedUntil: session.vaultUnlockedUntil },
    };
  }

  async validateApiKey(rawKey: string): Promise<AuthDto | null> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash: AuthService.hashToken(rawKey) },
      include: { user: true },
    });

    if (!apiKey || apiKey.user.status !== UserStatus.ACTIVE || apiKey.user.deletedAt) {
      return null;
    }

    return {
      user: {
        id: apiKey.user.id,
        email: apiKey.user.email,
        name: apiKey.user.name,
        isAdmin: apiKey.user.isAdmin,
        quotaSizeInBytes: apiKey.user.quotaSizeInBytes,
        quotaUsageInBytes: apiKey.user.quotaUsageInBytes,
      },
      apiKey: { id: apiKey.id, permissions: apiKey.permissions },
    };
  }

  async validateSharedLink(key: string): Promise<AuthDto | null> {
    const link = await this.prisma.sharedLink.findUnique({
      where: { key },
      include: { user: true, assets: { select: { assetId: true } } },
    });

    if (!link) return null;
    if (link.expiresAt && link.expiresAt < new Date()) return null;
    if (link.user.status !== UserStatus.ACTIVE || link.user.deletedAt) return null;

    return {
      user: {
        id: link.user.id,
        email: link.user.email,
        name: link.user.name,
        // A share key never grants administrative rights, whoever created it.
        isAdmin: false,
        quotaSizeInBytes: link.user.quotaSizeInBytes,
        quotaUsageInBytes: link.user.quotaUsageInBytes,
      },
      sharedLink: {
        id: link.id,
        albumId: link.albumId,
        allowUpload: link.allowUpload,
        allowDownload: link.allowDownload,
        showExif: link.showExif,
        assetIds: link.assets.map((a) => a.assetId),
      },
    };
  }

  // -- API keys -------------------------------------------------------------

  async createApiKey(userId: string, name: string, permissions: Permission[]) {
    const raw = `imadeo_${randomBytes(32).toString('base64url')}`;
    const record = await this.prisma.apiKey.create({
      data: {
        userId,
        name,
        keyHash: AuthService.hashToken(raw),
        permissions: permissions.length > 0 ? permissions : [Permission.READ, Permission.WRITE],
      },
    });
    // The only time the raw key is ever visible.
    return { id: record.id, name: record.name, secret: raw, createdAt: record.createdAt };
  }

  async deleteApiKey(userId: string, id: string) {
    const { count } = await this.prisma.apiKey.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('API key not found');
  }

  listApiKeys(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId },
      select: { id: true, name: true, permissions: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -- helpers --------------------------------------------------------------

  /**
   * When the session row lapses. In development this is pushed far out so it
   * outlives the non-expiring access token; otherwise it follows JWT_REFRESH_TTL.
   */
  private sessionExpiry(): Date {
    if (this.config.get('auth.persistentSession', { infer: true })) {
      return new Date('2999-12-31T00:00:00.000Z');
    }
    const days = this.parseTtlDays(this.config.get('auth.refreshTtl', { infer: true }));
    return new Date(Date.now() + days * 86_400_000);
  }

  /** Accepts `30d`, `12h`, `90m`. Everything is normalised to fractional days. */
  private parseTtlDays(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!match) return 180;
    const value = Number(match[1]);
    switch (match[2]) {
      case 's':
        return value / 86_400;
      case 'm':
        return value / 1_440;
      case 'h':
        return value / 24;
      default:
        return value;
    }
  }
}
