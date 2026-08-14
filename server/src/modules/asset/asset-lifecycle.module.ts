import { Module } from '@nestjs/common';
import { PeopleAndPetsModule } from '../person/people-and-pets.module';
import { AssetLifecycleService } from './asset-lifecycle.service';

@Module({
  imports: [PeopleAndPetsModule],
  providers: [AssetLifecycleService],
  exports: [AssetLifecycleService],
})
export class AssetLifecycleModule {}
