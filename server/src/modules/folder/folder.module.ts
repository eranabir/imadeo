import { Module } from '@nestjs/common';
import { AssetLifecycleModule } from '../asset/asset-lifecycle.module';
import { FolderController } from './folder.controller';
import { FolderService } from './folder.service';

@Module({
  imports: [AssetLifecycleModule],
  controllers: [FolderController],
  providers: [FolderService],
  exports: [FolderService],
})
export class FolderModule {}
