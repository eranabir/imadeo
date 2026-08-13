import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { AppConfig } from '../../config/configuration';
import { FolderModule } from '../folder/folder.module';
import { PeopleAndPetsModule } from '../person/people-and-pets.module';
import { UserModule } from '../user/user.module';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';
import { DuplicateService } from './duplicate.service';
import { MediaController } from './media.controller';
import { ClipProcessor } from './processors/clip.processor';
import { DuplicateProcessor } from './processors/duplicate.processor';
import { MetadataProcessor } from './processors/metadata.processor';
import { ThumbnailProcessor } from './processors/thumbnail.processor';
import { VideoProcessor } from './processors/video.processor';

@Module({
  imports: [
    FolderModule,
    PeopleAndPetsModule,
    UserModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const incoming = config.get('storage.incoming', { infer: true });
        return {
          // Uploads land on disk rather than in memory: a 4 GB video must not
          // have to fit in the heap.
          storage: diskStorage({
            destination: (_req, _file, cb) => {
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
  ],
  exports: [AssetService, DuplicateService],
})
export class AssetModule {}
