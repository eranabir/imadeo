import { Module } from '@nestjs/common';
import { DatabaseBackupService } from './database-backup.service';
import { StorageLocationService } from './storage-location.service';
import { SystemController } from './system.controller';

@Module({
  controllers: [SystemController],
  providers: [DatabaseBackupService, StorageLocationService],
})
export class SystemModule {}
