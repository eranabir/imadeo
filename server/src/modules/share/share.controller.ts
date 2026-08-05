import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthDto } from '../../common/auth.types';
import { Auth, Authed, AuthedUserId } from '../../common/decorators';
import { CreateSharedLinkDto, SharedLinkPasswordDto, UpdateSharedLinkDto } from './share.dto';
import { ShareService } from './share.service';

@ApiTags('Sharing')
@Controller('shared-links')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Auth()
  @Get()
  list(@AuthedUserId() userId: string) {
    return this.shareService.list(userId);
  }

  @Auth()
  @Post()
  @ApiOperation({ summary: 'Create a public link to an album or a set of photos' })
  create(@AuthedUserId() userId: string, @Body() dto: CreateSharedLinkDto) {
    return this.shareService.create(userId, dto);
  }

  @Auth()
  @Put(':id')
  update(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSharedLinkDto,
  ) {
    return this.shareService.update(userId, id, dto);
  }

  @Auth()
  @Delete(':id')
  remove(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.shareService.remove(userId, id);
  }

  // -- anonymous visitor surface -------------------------------------------

  @Auth({ public: true })
  @Get('public/:keyOrSlug')
  @ApiOperation({ summary: 'Open a public link. Returns requiresPassword when locked.' })
  resolve(@Param('keyOrSlug') keyOrSlug: string, @Query('password') password?: string) {
    return this.shareService.resolve(keyOrSlug, password);
  }

  @Auth({ public: true })
  @Post('public/:keyOrSlug/unlock')
  @ApiOperation({ summary: 'Submit the password for a protected link' })
  unlock(@Param('keyOrSlug') keyOrSlug: string, @Body() dto: SharedLinkPasswordDto) {
    return this.shareService.resolve(keyOrSlug, dto.password);
  }

  @Auth({ sharedLink: true })
  @Get('me/assets')
  @ApiOperation({ summary: 'Assets behind the share key used to authenticate this request' })
  myAssets(@Authed() auth: AuthDto) {
    if (!auth.sharedLink) return [];
    return this.shareService.listAssets(auth.sharedLink.id);
  }
}
