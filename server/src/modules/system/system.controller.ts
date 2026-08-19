import { Body, Controller, Get, HttpCode, Post, Put, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { Auth, AuthedUserId } from '../../common/decorators';
import { mainLibraryAssetWhere } from '../../common/asset-scope';
import { AssetType } from '../../db';
import { JOB, QUEUE } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { BackgroundTaskGate } from '../../infra/job/background-task-gate.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AppConfig } from '../../config/configuration';
import { MailSettingsService } from '../../infra/mail/mail-settings.service';
import { FaceRecognitionSettingsService } from '../../infra/ml/face-recognition-settings.service';
import { StorageLocationService } from './storage-location.service';
import { DatabaseBackupService } from './database-backup.service';
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
    private readonly databaseBackup: DatabaseBackupService,
    private readonly backgroundTasks: BackgroundTaskGate,
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

  @Auth()
  @Post('activity')
  @HttpCode(204)
  @ApiOperation({ summary: 'Pause heavy background work while a signed-in user is active' })
  activity() {
    this.backgroundTasks.noteUserActivity();
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
  async saveFaceRecognitionSettings(@Body() dto: UpdateFaceRecognitionDto) {
    const previous = this.faceRecognition.view();
    const settings = await this.faceRecognition.save(dto);

    const recognitionJustEnabled = !previous.enabled && settings.enabled;
    const videosJustEnabled = !previous.videosEnabled && settings.videosEnabled;
    if (!settings.enabled || (!recognitionJustEnabled && !videosJustEnabled)) return settings;

    const types = recognitionJustEnabled
      ? settings.videosEnabled
        ? [AssetType.IMAGE, AssetType.VIDEO]
        : [AssetType.IMAGE]
      : [AssetType.VIDEO];
    const assets = await this.prisma.asset.findMany({
      where: {
        ...mainLibraryAssetWhere(),
        type: { in: types },
        previewPath: { not: null },
        OR: [{ jobStatus: null }, { jobStatus: { facesRecognizedAt: null } }],
      },
      select: { id: true, type: true },
    });

    const photos = assets.filter((asset) => asset.type === AssetType.IMAGE).map(({ id }) => id);
    const videos = assets.filter((asset) => asset.type === AssetType.VIDEO).map(({ id }) => id);
    const ids = [...photos, ...videos];
    await this.jobs.releaseJobIds(QUEUE.FACE_DETECTION, JOB.DETECT_FACES, ids);
    await this.jobs.enqueueMany(
      QUEUE.FACE_DETECTION,
      JOB.DETECT_FACES,
      photos.map((assetId) => ({ assetId })),
    );
    await this.jobs.enqueueMany(
      QUEUE.FACE_DETECTION,
      JOB.DETECT_FACES,
      videos.map((assetId) => ({ assetId })),
      20,
    );

    return { ...settings, queued: ids.length };
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

  @Auth({ admin: true })
  @Post('admin/database/backup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create and download a PostgreSQL database backup' })
  async downloadDatabaseBackup(@Res() res: Response) {
    const backup = await this.databaseBackup.create();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', backup.size);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.fileName}"`);

    const stream = createReadStream(backup.path);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void backup.cleanup();
    };
    stream.once('error', () => res.destroy());
    res.once('close', cleanup);
    res.once('finish', cleanup);
    stream.pipe(res);
  }

  @Auth()
  @Get('server/storage')
  @ApiOperation({ summary: 'Where media is written on this machine, and how it is installed' })
  storage(@AuthedUserId() userId: string) {
    return this.storageLocation.describe(userId);
  }
}
