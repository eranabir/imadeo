import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import type { Prisma } from '../../db';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface OAuthSettings {
  google: { clientId: string; clientSecret: string };
  apple: { clientId: string; teamId: string; keyId: string; privateKey: string };
}

/** What the admin screen is allowed to see: presence, never the secret itself. */
export interface OAuthSettingsView {
  google: { clientId: string; hasClientSecret: boolean; enabled: boolean; fromEnv: boolean };
  apple: {
    clientId: string;
    teamId: string;
    keyId: string;
    hasPrivateKey: boolean;
    enabled: boolean;
    fromEnv: boolean;
  };
}

const CONFIG_KEY = 'oauth';

const EMPTY: OAuthSettings = {
  google: { clientId: '', clientSecret: '' },
  apple: { clientId: '', teamId: '', keyId: '', privateKey: '' },
};

/**
 * Google and Apple credentials, editable at runtime.
 *
 * They were originally read straight from the environment, which meant enabling
 * social sign-in required editing `.env` and restarting the server. Values are
 * now stored in `system_config` and cached in memory, so an administrator can
 * turn a provider on from Settings and have it take effect immediately. The
 * environment is still honoured as the default, so existing deployments keep
 * working untouched.
 */
@Injectable()
export class OAuthSettingsService implements OnModuleInit {
  private readonly logger = new Logger(OAuthSettingsService.name);

  private cached: OAuthSettings = EMPTY;
  /** Which fields came from `.env` rather than the database, for the UI to explain. */
  private envBacked = { google: false, apple: false };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  /** Cached, so the five call sites in OAuthService stay synchronous. */
  get(): OAuthSettings {
    return this.cached;
  }

  async reload() {
    const env = this.config.get('oauth', { infer: true });

    let stored: Partial<OAuthSettings> = {};
    try {
      const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
      stored = (row?.value as Partial<OAuthSettings>) ?? {};
    } catch (error) {
      // A missing table or an unreachable database must not stop the server
      // booting — social sign-in simply stays on whatever `.env` provides.
      this.logger.warn(`Could not read OAuth settings, falling back to the environment: ${error}`);
    }

    // Field-by-field so a half-filled database row does not blank out a
    // credential the environment still supplies.
    const pick = (a: string | undefined, b: string | undefined) => a?.trim() || b?.trim() || '';

    this.cached = {
      google: {
        clientId: pick(stored.google?.clientId, env.google.clientId),
        clientSecret: pick(stored.google?.clientSecret, env.google.clientSecret),
      },
      apple: {
        clientId: pick(stored.apple?.clientId, env.apple.clientId),
        teamId: pick(stored.apple?.teamId, env.apple.teamId),
        keyId: pick(stored.apple?.keyId, env.apple.keyId),
        privateKey: pick(stored.apple?.privateKey, env.apple.privateKey),
      },
    };

    this.envBacked = {
      google: !stored.google?.clientId && Boolean(env.google.clientId),
      apple: !stored.apple?.clientId && Boolean(env.apple.clientId),
    };

    return this.cached;
  }

  view(): OAuthSettingsView {
    const { google, apple } = this.cached;
    return {
      google: {
        clientId: google.clientId,
        hasClientSecret: Boolean(google.clientSecret),
        enabled: Boolean(google.clientId && google.clientSecret),
        fromEnv: this.envBacked.google,
      },
      apple: {
        clientId: apple.clientId,
        teamId: apple.teamId,
        keyId: apple.keyId,
        hasPrivateKey: Boolean(apple.privateKey),
        enabled: Boolean(apple.clientId && apple.teamId && apple.keyId && apple.privateKey),
        fromEnv: this.envBacked.apple,
      },
    };
  }

  /**
   * Merges a patch over what is stored. Secret fields left `undefined` keep
   * their current value, so the admin screen can save a changed client ID
   * without having to re-type the secret it was never shown.
   */
  async save(patch: {
    google?: Partial<OAuthSettings['google']>;
    apple?: Partial<OAuthSettings['apple']>;
  }): Promise<OAuthSettingsView> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    const current = (row?.value as Partial<OAuthSettings>) ?? {};

    // An empty string is a deliberate "clear this"; undefined means "leave it".
    const merge = <T extends object>(base: Partial<T>, incoming: Partial<T> | undefined): T => {
      const next = { ...base } as T;
      for (const [key, value] of Object.entries(incoming ?? {})) {
        if (value !== undefined) (next as Record<string, unknown>)[key] = value;
      }
      return next;
    };

    const value: OAuthSettings = {
      google: merge(current.google ?? {}, patch.google),
      apple: merge(current.apple ?? {}, patch.apple),
    };

    // Prisma's Json input wants an index signature, which a named interface
    // does not have; the shape is plain JSON either way.
    const json = value as unknown as Prisma.InputJsonValue;

    await this.prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: json },
      update: { value: json },
    });

    await this.reload();
    return this.view();
  }
}
