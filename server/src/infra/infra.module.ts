import { Global, Module } from '@nestjs/common';
import { GeocodingService } from './geo/geocoding.service';
import { MailSettingsService } from './mail/mail-settings.service';
import { MailService } from './mail/mail.service';
import { MediaService } from './media/media.service';
import { MetadataService } from './metadata/metadata.service';
import { MachineLearningService } from './ml/ml.service';
import { StorageService } from './storage/storage.service';

/**
 * Stateless helpers that wrap the filesystem, sharp/ffmpeg and exiftool.
 * Global because nearly every feature module needs at least one of them.
 */
@Global()
@Module({
  providers: [
    StorageService,
    MediaService,
    MetadataService,
    MailService,
    MailSettingsService,
    MachineLearningService,
    GeocodingService,
  ],
  exports: [
    StorageService,
    MediaService,
    MetadataService,
    MailService,
    MailSettingsService,
    MachineLearningService,
    GeocodingService,
  ],
})
export class InfraModule {}
