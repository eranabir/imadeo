import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, AuthedUserId } from '../../common/decorators';
import { DeviceService } from './device.service';

@ApiTags('Devices')
@Auth()
@Controller('devices')
export class DeviceController {
  constructor(private readonly devices: DeviceService) {}

  @Get()
  @ApiOperation({ summary: 'Mobile device libraries owned by this account' })
  list(@AuthedUserId() userId: string) {
    return this.devices.list(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One mobile device library' })
  get(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.devices.get(userId, id);
  }
}
