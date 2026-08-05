import { Module } from '@nestjs/common';
import { StorageLocationService } from './storage-location.service';
import { SystemController } from './system.controller';

@Module({
  controllers: [SystemController],
  providers: [StorageLocationService],
})
export class SystemModule {}
