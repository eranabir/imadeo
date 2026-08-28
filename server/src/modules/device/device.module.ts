import { Module } from '@nestjs/common';
import { AssetLifecycleModule } from '../asset/asset-lifecycle.module';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';

@Module({
  imports: [AssetLifecycleModule],
  controllers: [DeviceController],
  providers: [DeviceService],
  exports: [DeviceService],
})
export class DeviceModule {}
