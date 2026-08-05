import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { AppConfig } from '../../config/configuration';
import { MailSettingsService } from './mail-settings.service';

export interface AlbumInvite {
  to: string;
  inviterName: string;
  albumName: string;
  albumUrl: string;
  /** Present only when the invite created a brand new account. */
  temporaryPassword?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly settings: MailSettingsService,
  ) {
    this.build();
    // Rebuilt whenever the settings are saved, so a corrected host takes effect
    // on the next message rather than the next restart.
    this.settings.watch(() => this.build());
  }

  private build() {
    const smtp = this.settings.get();

    if (!smtp.host) {
      this.transporter = null;
      this.logger.log('SMTP is not configured; invites are returned as links instead');
      return;
    }

    this.transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    });
    this.logger.log(`SMTP ready via ${smtp.host}:${smtp.port}`);
  }

  /** Proves the credentials work, without waiting for a real invitation. */
  async sendTest(to: string): Promise<{ sent: boolean; error?: string }> {
    if (!this.transporter) return { sent: false, error: 'No mail server is configured' };
    try {
      await this.transporter.verify();
      await this.transporter.sendMail({
        from: this.settings.get().from,
        to,
        subject: 'Imadeo test message',
        text: 'Email is working. Invitations sent from this server will reach people.',
      });
      return { sent: true };
    } catch (error) {
      return { sent: false, error: (error as Error).message };
    }
  }

  /** The public address links should use. */
  settingsFor() {
    return this.settings.get();
  }

  get isConfigured() {
    return this.transporter !== null;
  }

  /**
   * Confirms a new address before it becomes the account's login identifier.
   * Deliberately sent to the *new* address only: the point is to prove that
   * inbox is reachable by whoever asked for the change.
   */
  async sendEmailChangeConfirmation(input: {
    to: string;
    name: string;
    url: string;
  }): Promise<{ sent: boolean; error?: string }> {
    if (!this.transporter) return { sent: false };

    try {
      await this.transporter.sendMail({
        from: this.settings.get().from,
        to: input.to,
        subject: 'Confirm your new Imadeo email address',
        text:
          `Hello ${input.name},\n\n` +
          `Confirm this address to finish moving your Imadeo account to it:\n\n` +
          `${input.url}\n\n` +
          `The link is good for 24 hours. If you did not ask for this, ignore it — ` +
          `nothing changes until the link is opened.\n`,
        html: this.shell({
          heading: 'Confirm your new email address',
          body: `Hello ${input.name}, confirm this address to finish moving your Imadeo account to it.`,
          buttonLabel: 'Confirm this address',
          buttonUrl: input.url,
          footer:
            'The link is good for 24 hours. If you did not ask for this, ignore it — nothing changes until the link is opened.',
        }),
      });
      return { sent: true };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Could not send the confirmation to ${input.to}: ${message}`);
      return { sent: false, error: message };
    }
  }

  /**
   * Invites someone to the server itself.
   *
   * Separate from the album share, which it used to borrow: that template
   * talked about an album, so a plain invitation arrived saying someone had
   * shared "your library" and offering to open an album that did not exist.
   */
  async sendInvitation(input: {
    to: string;
    inviterName: string;
    url: string;
    expiresInDays: number;
  }): Promise<{ sent: boolean; error?: string }> {
    if (!this.transporter) return { sent: false };

    try {
      await this.transporter.sendMail({
        from: this.settings.get().from,
        to: input.to,
        subject: `${input.inviterName} invited you to Imadeo`,
        text:
          `${input.inviterName} has invited you to their Imadeo photo library.

` +
          `Create your account here:
${input.url}

` +
          `The link is good for ${input.expiresInDays} days. You choose your own ` +
          `name and password — no password is ever sent by email.
`,
        html: this.shell({
          heading: `${input.inviterName} invited you to Imadeo`,
          body: 'Imadeo is a private photo library. Create an account to see the photos and videos shared with you.',
          buttonLabel: 'Create your account',
          buttonUrl: input.url,
          footer: `This link is good for ${input.expiresInDays} days. You pick your own password — none is ever sent by email. If you were not expecting this, you can ignore it.`,
        }),
      });
      return { sent: true };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Could not invite ${input.to}: ${message}`);
      return { sent: false, error: message };
    }
  }

  /**
   * One frame for every message, so email matches the app rather than each
   * template inventing its own colours and spacing. Inline styles and a table
   * because mail clients ignore stylesheets and much of modern CSS.
   */
  private shell(input: {
    heading: string;
    body: string;
    buttonLabel: string;
    buttonUrl: string;
    footer: string;
    extra?: string;
  }) {
    // The app's accent, resolved to hex — oklch is not safe in mail clients.
    const accent = '#0f7d8c';
    return `
      <div style="background:#f4f7f8;padding:32px 16px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e2e8ea">
          <tr>
            <td style="padding:28px 28px 0">
              <span style="display:inline-block;font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${accent}">Imadeo</span>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 0">
              <h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;font-weight:600;color:#1c2024">${input.heading}</h1>
              <p style="margin:0;font-size:14px;line-height:1.55;color:#5b6570">${input.body}</p>
              ${input.extra ?? ''}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 0">
              <a href="${input.buttonUrl}"
                 style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-size:14px;font-weight:600">
                ${input.buttonLabel}
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 28px">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#8b949e">${input.footer}</p>
            </td>
          </tr>
        </table>
      </div>`;
  }

  /**
   * Sends an album invite. Returns whether it actually went out — a
   * self-hosted server very often has no mail relay, and in that case the
   * caller shows the link to copy rather than pretending an email was sent.
   */
  async sendAlbumInvite(invite: AlbumInvite): Promise<{ sent: boolean; error?: string }> {
    if (!this.transporter) return { sent: false };

    const from = this.settings.get().from;

    const credentials = invite.temporaryPassword
      ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.55;color:#5b6570">An account was created for you. Sign in with <strong>${invite.to}</strong> and the temporary password <strong>${invite.temporaryPassword}</strong>, then change it from Settings.</p>`
      : '';

    try {
      await this.transporter.sendMail({
        from,
        to: invite.to,
        subject: `${invite.inviterName} shared the album “${invite.albumName}” with you`,
        text:
          `${invite.inviterName} shared the album "${invite.albumName}" with you.\n\n` +
          `${invite.albumUrl}\n` +
          (invite.temporaryPassword
            ? `\nAn account was created for you. Sign in with ${invite.to} and the temporary password ${invite.temporaryPassword}, then change it from Settings.\n`
            : ''),
        html: this.shell({
          heading: `${invite.inviterName} shared an album with you`,
          body: `“${invite.albumName}”`,
          extra: credentials,
          buttonLabel: 'Open the album',
          buttonUrl: invite.albumUrl,
          footer: 'Sent by Imadeo. If you were not expecting this, you can ignore it.',
        }),
      });
      return { sent: true };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Could not send the invite to ${invite.to}: ${message}`);
      return { sent: false, error: message };
    }
  }
}
