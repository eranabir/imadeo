import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, AuthedUserId } from '../../common/decorators';
import { JobService } from '../../infra/job/job.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AppConfig } from '../../config/configuration';
import { MailSettingsService } from '../../infra/mail/mail-settings.service';
import { FaceRecognitionSettingsService } from '../../infra/ml/face-recognition-settings.service';
import { StorageLocationService } from './storage-location.service';
import { UpdateFaceRecognitionDto, UpdateMailDto } from './system.dto';

@ApiTags('System')
@Controller()
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly storageLocation: StorageLocationService,
    private readonly mailSettings: MailSettingsService,
    private readonly faceRecognition: FaceRecognitionSettingsService,
    private readonly jobs: JobService,
  ) {}

  @Auth({ public: true })
  @Get()
  @ApiOperation({ summary: 'Root ping. Always answers, even if the database is down.' })
  root() {
    return {
      message: 'Imadeo is up',
      version: '0.1.0',
      docs: '/api/docs',
      timestamp: new Date().toISOString(),
    };
  }

  @Auth({ public: true })
  @Get('health')
  @ApiOperation({ summary: 'Liveness and dependency check' })
  async health() {
    // Asked together: one dependency being down should not hide the other.
    const [database, redis] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`.then(() => 'ok')
        .catch(() => 'unavailable'),
      this.jobs.isRedisReachable().then((ok) => (ok ? 'ok' : 'unavailable')),
    ]);

    const ok = database === 'ok' && redis === 'ok';
    return { status: ok ? 'ok' : 'degraded', database, redis, uptime: process.uptime() };
  }

  @Auth({ public: true })
  @Get('server/about')
  @ApiOperation({ summary: 'Version and feature flags, used by the clients on startup' })
  async about() {
    const [userCount, isInitialised] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isAdmin: true } }).then((n) => n > 0),
    ]);

    return {
      version: '0.1.0',
      isInitialised,
      userCount,
      features: {
        machineLearning: this.config.get('machineLearning.enabled', { infer: true }),
        duplicateDetection: this.config.get('duplicates.enabled', { infer: true }),
        trash: this.config.get('trash.enabled', { infer: true }),
        publicRegistration: this.config.get('auth.publicRegistration', { infer: true }),
        vault: Boolean(this.config.get('auth.vaultMasterKey', { infer: true })),
      },
      trashRetentionDays: this.config.get('trash.retentionDays', { infer: true }),
    };
  }

  @Auth({ admin: true })
  @Get(['admin/people-and-pets-recognition', 'admin/face-recognition'])
  @ApiOperation({ summary: 'People and pets recognition setting for this server' })
  faceRecognitionSettings() {
    return this.faceRecognition.view();
  }

  @Auth({ admin: true })
  @Put(['admin/people-and-pets-recognition', 'admin/face-recognition'])
  @ApiOperation({ summary: 'Enable or disable people and pets recognition immediately' })
  saveFaceRecognitionSettings(@Body() dto: UpdateFaceRecognitionDto) {
    return this.faceRecognition.save(dto.enabled);
  }

  @Auth({ admin: true })
  @Get('admin/mail')
  @ApiOperation({ summary: 'SMTP settings, with the password withheld' })
  getMailSettings() {
    return this.mailSettings.view();
  }

  @Auth({ admin: true })
  @Put('admin/mail')
  @ApiOperation({ summary: 'Save SMTP settings. Takes effect on the next message.' })
  saveMailSettings(@Body() dto: UpdateMailDto) {
    return this.mailSettings.save(dto);
  }

  @Auth()
  @Get('server/storage')
  @ApiOperation({ summary: 'Where media is written on this machine, and how it is installed' })
  async storage(@AuthedUserId() userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { storageLabel: true },
    });
    return this.storageLocation.describe(user.storageLabel);
  }
}
