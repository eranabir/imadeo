import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthDto } from '../../common/auth.types';
import { Auth, Authed, AuthedUserId } from '../../common/decorators';
import type { AppConfig } from '../../config/configuration';
import {
  ConfirmEmailChangeDto,
  CreateUserDto,
  DeleteOwnAccountDto,
  UpdatePreferencesDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './user.dto';
import { UserService } from './user.service';

@ApiTags('Users')
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Auth()
  @Get('me')
  me(@AuthedUserId() userId: string) {
    return this.userService.me(userId);
  }

  @Auth()
  @Get('me/deletion')
  @ApiOperation({ summary: 'How to delete your own account and retain an administrator' })
  deletionOptions(@Authed() auth: AuthDto) {
    if (!auth.session) throw new ForbiddenException('Sign in with your account to delete it. API keys cannot delete accounts.');
    return this.userService.deletionOptions(auth.user.id);
  }

  @Auth()
  @Delete('me')
  @ApiOperation({ summary: 'Request permanent deletion of your own account after 30 days' })
  deleteOwnAccount(@Authed() auth: AuthDto, @Body() dto: DeleteOwnAccountDto) {
    if (!auth.session) throw new ForbiddenException('Sign in with your account to delete it. API keys cannot delete accounts.');
    return this.userService.deleteOwnAccount(auth.user.id, dto);
  }

  @Auth()
  @Put('me')
  @ApiOperation({ summary: 'Update your own name or email' })
  updateProfile(@AuthedUserId() userId: string, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(userId, dto);
  }

  @Auth()
  @Get('me/email-change')
  @ApiOperation({ summary: 'The email change awaiting confirmation, if any' })
  pendingEmailChange(@AuthedUserId() userId: string) {
    return this.userService.pendingEmailChange(userId);
  }

  @Auth()
  @Post('me/email-change/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete an email change using the token from the link' })
  confirmEmailChange(@AuthedUserId() userId: string, @Body() dto: ConfirmEmailChangeDto) {
    return this.userService.confirmEmailChange(userId, dto.token);
  }

  @Auth()
  @Delete('me/email-change')
  @ApiOperation({ summary: 'Abandon a pending email change' })
  cancelEmailChange(@AuthedUserId() userId: string) {
    return this.userService.cancelEmailChange(userId);
  }

  @Auth()
  @Put('me/preferences')
  @ApiOperation({ summary: 'Update client preferences including light/dark theme' })
  updatePreferences(@AuthedUserId() userId: string, @Body() dto: UpdatePreferencesDto) {
    return this.userService.updatePreferences(userId, dto);
  }

  @Auth()
  @Get('me/statistics')
  @ApiOperation({ summary: 'Library counts plus real disk usage for the media volume' })
  async statistics(@AuthedUserId() userId: string) {
    const [library, disk] = await Promise.all([
      this.userService.statistics(userId),
      this.userService.diskUsage(this.config.get('storage.root', { infer: true })),
    ]);
    return { ...library, disk };
  }

  @Auth()
  @Get()
  @ApiOperation({ summary: 'User accounts you can share albums with' })
  listPeers(@AuthedUserId() userId: string) {
    return this.userService.listPeers(userId);
  }
}

@ApiTags('Users (admin)')
@Auth({ admin: true })
@Controller('admin/users')
export class UserAdminController {
  constructor(private readonly userService: UserService) {}

  @Get()
  listAll() {
    return this.userService.listAll();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.userService.get(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @AuthedUserId() callerId: string) {
    return this.userService.create(dto, callerId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Queue an account for removal' })
  softDelete(@Param('id') id: string, @Authed() auth: AuthDto) {
    return this.userService.softDelete(id, auth.user.id);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.userService.restore(id);
  }

  @Post(':id/recalculate-usage')
  async recalculate(@Param('id') id: string) {
    const total = await this.userService.recalculateUsage(id);
    return { quotaUsageInBytes: total };
  }
}
