import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../db';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

interface FaceRecognitionSettings {
  enabled: boolean;
}

const CONFIG_KEY = 'face-recognition';

/**
 * Server-wide People & Pets recognition switch.
 *
 * `ML_ENABLED` remains the first-run default, but an administrator can change
 * this setting without editing an environment file or restarting the server.
 */
@Injectable()
export class FaceRecognitionSettingsService implements OnModuleInit {
  private readonly logger = new Logger(FaceRecognitionSettingsService.name);
  private cached = true;
  private envBacked = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  get enabled() {
    return this.cached;
  }

  async reload() {
    const fallback = this.config.get('machineLearning.enabled', { infer: true });

    try {
      const row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
      const stored = row?.value as Partial<FaceRecognitionSettings> | undefined;
      this.envBacked = typeof stored?.enabled !== 'boolean';
      this.cached = stored?.enabled ?? fallback;
    } catch (error) {
      this.envBacked = true;
      this.cached = fallback;
      this.logger.warn(
        `Could not read face-recognition settings, falling back to the environment: ${error}`,
      );
    }
  }

  view() {
    return { enabled: this.cached, fromEnv: this.envBacked };
  }

  async save(enabled: boolean) {
    const value = { enabled } as Prisma.InputJsonValue;
    await this.prisma.systemConfig.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value },
      update: { value },
    });
    this.cached = enabled;
    this.envBacked = false;
    return this.view();
  }
}
