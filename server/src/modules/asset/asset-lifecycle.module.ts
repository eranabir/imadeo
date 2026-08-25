import { Module } from '@nestjs/common';
import { PeopleAndPetsModule } from '../person/people-and-pets.module';
import { AssetLifecycleService } from './asset-lifecycle.service';
import { AssetProcessingService } from './asset-processing.service';

@Module({
  imports: [PeopleAndPetsModule],
  providers: [AssetLifecycleService, AssetProcessingService],
  exports: [AssetLifecycleService, AssetProcessingService],
})
export class AssetLifecycleModule {}
