import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Request } from 'express';
import type { AuthDto } from '../../common/auth.types';
import type { AppConfig } from '../../config/configuration';
import { FolderModule } from '../folder/folder.module';
import { DeviceModule } from '../device/device.module';
import { PeopleAndPetsModule } from '../person/people-and-pets.module';
import { UserModule } from '../user/user.module';
import { AssetController } from './asset.controller';
import { AssetLifecycleModule } from './asset-lifecycle.module';
import { AssetService } from './asset.service';
import { DuplicateService } from './duplicate.service';
import { MediaController } from './media.controller';
import { ClipProcessor } from './processors/clip.processor';
import { DuplicateProcessor } from './processors/duplicate.processor';
import { MetadataProcessor } from './processors/metadata.processor';
import { ThumbnailProcessor } from './processors/thumbnail.processor';
import { VideoProcessor } from './processors/video.processor';
import { UploadPriorityInterceptor } from './upload-priority.interceptor';

@Module({
  imports: [
    FolderModule,
    DeviceModule,
    PeopleAndPetsModule,
    AssetLifecycleModule,
    UserModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const users = config.get('storage.users', { infer: true });
        return {
          // Uploads land on disk rather than in memory: a 4 GB video must not
          // have to fit in the heap.
          storage: diskStorage({
            destination: (request, _file, cb) => {
              const auth = (request as Request & { auth?: AuthDto }).auth;
              if (!auth?.user.id) return cb(new Error('Authenticated user is required'), '');
              const incoming = join(users, auth.user.id, 'upload');
              mkdirSync(incoming, { recursive: true });
              cb(null, incoming);
            },
            filename: (_req, file, cb) => {
              // The real name is kept in the database; on disk a random name
              // avoids collisions and path tricks in the client-supplied name.
              cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
            },
          }),
          limits: { fileSize: config.get('storage.maxUploadBytes', { infer: true }) },
        };
      },
    }),
  ],
  controllers: [AssetController, MediaController],
  providers: [
    AssetService,
    DuplicateService,
    MetadataProcessor,
    ThumbnailProcessor,
    VideoProcessor,
    DuplicateProcessor,
    ClipProcessor,
    UploadPriorityInterceptor,
  ],
  exports: [AssetService, DuplicateService],
})
export class AssetModule {}
