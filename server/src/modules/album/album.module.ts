import { Module } from '@nestjs/common';
import { AssetLifecycleModule } from '../asset/asset-lifecycle.module';
import { AlbumController } from './album.controller';
import { AlbumService } from './album.service';

@Module({
  imports: [AssetLifecycleModule],
  controllers: [AlbumController],
  providers: [AlbumService],
  exports: [AlbumService],
})
export class AlbumModule {}
