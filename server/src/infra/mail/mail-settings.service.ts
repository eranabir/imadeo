import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type { Prisma } from '../../db';
import { PrismaService } from '../prisma/prisma.service';

export interface MailSettings {
  /**
   * The address to put in links that leave the server.
   *
   * Distinct from where the app is served: a self-hosted install is reached at
   * localhost by its owner but at a public hostname by everyone else, and an
   * invitation containing "localhost" points the recipient at their own
   * machine. Whoever installs Imadeo decides what that address is — a port
   * forward with dynamic DNS, a tunnel, whatever they chose — so it has to be
   * a setting rather than an assumption.
   */
  publicUrl: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/** What the admin screen may see: never the password itself. */
export interface MailSettingsView {
  publicUrl: string;
  publicUrlFromEnv: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPassword: boolean;
  from: string;
  configured: boolean;
  fromEnv: boolean;
}

const CONFIG_KEY = 'smtp';

/**
 * SMTP credentials, editable at runtime.
 *
 * They were read from the environment at boot, which meant that turning email
 * on required editing `.env` and restarting — and until then every invitation
 * fell back to "copy this link yourself". Stored in `system_config` now, so an
 * administrator can set them from Settings and have the next message actually
 * send. The environment is still the default, so existing deployments are
 * unaffected.
 */
@Injectable()
export class MailSettingsService implements OnModuleInit {
  private readonly logger = new Logger(MailSettingsService.name);

  private cached: MailSettings = {
    publicUrl: '',
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    from: '',
  };
  private envBacked = false;
  private publicUrlEnvBacked = true;
  /** Called after a save so the transporter is rebuilt with the new details. */
  private onChange: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit() {
    await this.reload();
    // MailService builds its transporter in its constructor, which runs before
    // this — so at that point it sees the empty defaults. Without this notify it
    // would keep believing email is unconfigured until someone saved the form
    // again, which is what made invitations fail after every restart.
    this.onChange?.();
  }

  watch(listener: () => void) {
    this.onChange = listener;
  }

  get(): MailSettings {
    return this.cached;
  }

  async reload() {
    const env = this.config.get('smtp', { infer: true });

    let stored: Partial<MailSettings> = {};
    try {
      const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
      stored = (row?.value as Partial<MailSettings>) ?? {};
    } catch (error) {
      // A database that is not ready must not stop the server booting.
      this.logger.warn(`Could not read mail settings, using the environment: ${error}`);
    }

    const envPublicUrl = this.config.get('publicUrl', { infer: true });

    this.cached = {
      /**
       * Cleared field falls back rather than going blank — `||` not `??`, so an
       * empty string is treated as "not set" instead of as a value. A link built
       * from an empty address would be broken in a way that is hard to spot.
       * Trailing slash removed so links never end up with a double slash.
       */
      publicUrl: (stored.publicUrl?.trim() || envPublicUrl || 'http://localhost:2283').replace(
        /\/$/,
        '',
      ),
      host: (stored.host ?? env.host ?? '').trim(),
      port: stored.port ?? env.port ?? 587,
      // Port 465 is implicit TLS; everything else negotiates STARTTLS after
              // connecting. That is a rule, not a preference, so it is derived
              // rather than asked about.
      secure: (stored.port ?? env.port ?? 587) === 465,
      user: (stored.user ?? env.user ?? '').trim(),
      password: stored.password ?? env.password ?? '',
      from: (stored.from ?? env.from ?? '').trim(),
    };

    this.envBacked = !stored.host && Boolean(env.host);
    this.publicUrlEnvBacked = !stored.publicUrl?.trim();
    return this.cached;
  }

  view(): MailSettingsView {
    const { publicUrl, host, port, secure, user, password, from } = this.cached;
    return {
      publicUrl,
      publicUrlFromEnv: this.publicUrlEnvBacked,
      host,
      port,
      secure,
      user,
      hasPassword: Boolean(password),
      from,
      configured: Boolean(host),
      fromEnv: this.envBacked,
    };
  }

  /**
   * Merges a patch over what is stored. An omitted password keeps the current
   * one, so the host can be corrected without re-typing a secret that was never
   * displayed.
   */
  async save(patch: Partial<MailSettings>): Promise<MailSettingsView> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    const current = (row?.value as Partial<MailSettings>) ?? {};

    const value: Partial<MailSettings> = { ...current };
    for (const [key, entry] of Object.entries(patch)) {
      if (entry !== undefined) (value as Record<string, unknown>)[key] = entry;
    }

    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: json },
      update: { value: json },
    });

    await this.reload();
    this.onChange?.();
    return this.view();
  }
}
