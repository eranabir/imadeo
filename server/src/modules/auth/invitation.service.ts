import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { AlbumUserRole } from '../../db';
import type { AppConfig } from '../../config/configuration';
import { MailService } from '../../infra/mail/mail.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';

const INVITE_TTL_DAYS = 14;

@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly storage: StorageService,
  ) {}

  private static hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Creates an invitation and returns the link.
   *
   * Nothing is created in `users` yet: the person sets their own name and
   * password when they accept, so no credential ever travels through email.
   */
  async create(input: {
    email: string;
    invitedById: string;
    inviterName: string;
    albumId?: string | null;
    albumName?: string;
    role?: AlbumUserRole;
  }) {
    const email = input.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('That address already has an account');
    }

    const token = randomBytes(32).toString('base64url');

    // One live invitation per address per album; re-inviting refreshes the link.
    await this.prisma.invitation.deleteMany({
      where: { email, albumId: input.albumId ?? null, acceptedAt: null },
    });

    await this.prisma.invitation.create({
      data: {
        email,
        tokenHash: InvitationService.hash(token),
        invitedById: input.invitedById,
        albumId: input.albumId ?? null,
        role: input.role ?? AlbumUserRole.VIEWER,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      },
    });

    const url = `${this.mail.settingsFor().publicUrl}/register?invite=${token}`;

    // An album share and a plain invitation are different messages. Only the
    // former should talk about an album.
    const delivery = input.albumId
      ? await this.mail.sendAlbumInvite({
          to: email,
          inviterName: input.inviterName,
          albumName: input.albumName ?? 'an album',
          albumUrl: url,
        })
      : await this.mail.sendInvitation({
          to: email,
          inviterName: input.inviterName,
          url,
          expiresInDays: INVITE_TTL_DAYS,
        });

    return { email, url, emailSent: delivery.sent, expiresInDays: INVITE_TTL_DAYS };
  }

  /**
   * Rejects an unusable invitation with a machine-readable reason, so the
   * register screen can explain what actually went wrong rather than showing
   * one catch-all "not valid" for three different situations.
   */
  private ensureUsable<T extends { acceptedAt: Date | null; expiresAt: Date }>(
    invitation: T | null,
  ): T {
    if (!invitation) {
      throw new NotFoundException({
        message: 'That invitation link is not valid.',
        code: 'INVITE_INVALID',
      });
    }
    if (invitation.acceptedAt) {
      throw new BadRequestException({
        message: 'That invitation has already been used.',
        code: 'INVITE_USED',
      });
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException({
        message: 'That invitation has expired.',
        code: 'INVITE_EXPIRED',
        expiredAt: invitation.expiresAt.toISOString(),
      });
    }
    return invitation;
  }

  /** What the register screen needs to show before the account exists. */
  async describe(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: InvitationService.hash(token) },
      include: {
        invitedBy: { select: { name: true, email: true } },
        album: { select: { id: true, name: true } },
      },
    });

    const usable = this.ensureUsable(invitation);

    return {
      email: usable.email,
      invitedBy: usable.invitedBy.name,
      // Shown so an expired invite has someone concrete to ask for a new one.
      invitedByEmail: usable.invitedBy.email,
      album: usable.album,
      expiresAt: usable.expiresAt,
    };
  }

  /**
   * Turns an invitation into a real account.
   *
   * `oauth` is set when the person chose Google or Apple instead of a password;
   * in that case there is no password to store at all.
   */
  async accept(input: {
    token: string;
    name: string;
    password?: string;
    oauth?: { provider: string; subject: string };
  }) {
    const tokenHash = InvitationService.hash(input.token);

    const invitation = this.ensureUsable(
      await this.prisma.invitation.findUnique({ where: { tokenHash } }),
    );

    if (await this.prisma.user.findUnique({ where: { email: invitation.email } })) {
      throw new BadRequestException('That address already has an account');
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invitation.email,
          name: input.name.trim() || invitation.email.split('@')[0],
          password: input.password ? await bcrypt.hash(input.password, 12) : '',
          oauthProvider: input.oauth?.provider ?? null,
          oauthId: input.oauth?.subject ?? null,
          // Invited accounts are never administrators.
          isAdmin: false,
          shouldChangePassword: false,
          storageLabel: this.storageLabelFor(invitation.email),
        },
      });

      // Joining the album is the whole point of the invitation.
      if (invitation.albumId) {
        await tx.albumUser.create({
          data: { albumId: invitation.albumId, userId: user.id, role: invitation.role },
        });
      }

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      return user;
    });
    await this.storage.ensureUserRoot(user.id);
    return user;
  }

  list(invitedById: string) {
    return this.prisma.invitation.findMany({
      where: { invitedById, acceptedAt: null },
      include: { album: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(invitedById: string, id: string) {
    const { count } = await this.prisma.invitation.deleteMany({ where: { id, invitedById } });
    if (count === 0) throw new NotFoundException('Invitation not found');
    return { successful: true };
  }

  private storageLabelFor(email: string) {
    const base = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const suffix = createHash('sha1').update(email).digest('hex').slice(0, 6);
    return `${base || 'user'}-${suffix}`;
  }
}
