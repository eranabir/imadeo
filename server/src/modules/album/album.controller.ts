import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { assertVaultUnlocked } from '../../common/auth.guard';
import type { AuthDto } from '../../common/auth.types';
import { Auth, Authed, AuthedUserId } from '../../common/decorators';
import { AlbumUserRole } from '../../db';
import {
  AlbumAssetsDto,
  AlbumAssetsQueryDto,
  AlbumQueryDto,
  AlbumUserDto,
  CreateActivityDto,
  CreateAlbumDto,
  InviteToAlbumDto,
  SetAlbumLockDto,
  UpdateAlbumDto,
  UpdateAlbumUserDto,
} from './album.dto';
import { AlbumService } from './album.service';

@ApiTags('Albums')
@Auth()
@Controller('albums')
export class AlbumController {
  constructor(private readonly albumService: AlbumService) {}

  @Get()
  @ApiOperation({ summary: 'Albums you own or that are shared with you' })
  list(@AuthedUserId() userId: string, @Query() query: AlbumQueryDto) {
    return this.albumService.list(userId, query);
  }

  @Get('statistics')
  statistics(@AuthedUserId() userId: string) {
    return this.albumService.statistics(userId);
  }

  @Get('trash')
  trash(@AuthedUserId() userId: string) {
    return this.albumService.listTrash(userId);
  }

  @Post()
  create(@AuthedUserId() userId: string, @Body() dto: CreateAlbumDto) {
    return this.albumService.create(userId, dto);
  }

  @Auth({ sharedLink: true })
  @Get(':id')
  get(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Query() query: AlbumAssetsQueryDto,
  ) {
    return this.albumService.get(auth, id, query);
  }

  @Auth({ sharedLink: true })
  @Get(':id/processing-status')
  @ApiOperation({ summary: 'Thumbnail processing progress for media inside an album' })
  processingStatus(@Authed() auth: AuthDto, @Param('id') id: string) {
    return this.albumService.processingStatus(auth, id);
  }

  @Put(':id')
  update(@Authed() auth: AuthDto, @Param('id') id: string, @Body() dto: UpdateAlbumDto) {
    return this.albumService.update(auth, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Move an album and its photos to Trash' })
  remove(@Authed() auth: AuthDto, @Param('id') id: string) {
    return this.albumService.remove(auth, id);
  }

  @Post(':id/restore')
  restore(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.albumService.restore(userId, id);
  }

  @Delete(':id/permanent')
  deletePermanently(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.albumService.deletePermanently(userId, id);
  }

  @Auth({ sharedLink: true })
  @Put(':id/assets')
  addAssets(@Authed() auth: AuthDto, @Param('id') id: string, @Body() dto: AlbumAssetsDto) {
    return this.albumService.addAssets(auth, id, dto.assetIds, dto.removeFromFolder);
  }

  @Auth({ sharedLink: true })
  @Get(':id/assets/ids')
  @ApiOperation({ summary: 'Every live asset id in this album, without pagination' })
  assetIds(@Authed() auth: AuthDto, @Param('id') id: string) {
    return this.albumService.getAssetIds(auth, id);
  }

  @Delete(':id/assets')
  @ApiOperation({ summary: 'Move owned media in this album to Trash' })
  removeAssets(@Authed() auth: AuthDto, @Param('id') id: string, @Body() dto: AlbumAssetsDto) {
    return this.albumService.removeAssets(auth, id, dto.assetIds);
  }

  // -- sharing --------------------------------------------------------------

  @Put(':id/users')
  @ApiOperation({ summary: 'Share the album with other accounts' })
  addUsers(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Body() body: { albumUsers: AlbumUserDto[] },
  ) {
    return this.albumService.addUsers(auth, id, body.albumUsers ?? []);
  }

  @Post(':id/invite')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Share an album with an email address',
    description:
      'Creates an account if the address is unknown. When no SMTP relay is configured the response carries the link and any temporary password so they can be passed on by hand.',
  })
  invite(@Authed() auth: AuthDto, @Param('id') id: string, @Body() dto: InviteToAlbumDto) {
    return this.albumService.inviteByEmail(auth, id, dto.email, dto.role ?? AlbumUserRole.VIEWER);
  }

  @Put(':id/user/:userId')
  updateUserRole(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateAlbumUserDto,
  ) {
    return this.albumService.updateUserRole(auth, id, userId, dto.role);
  }

  @Delete(':id/user/:userId')
  @ApiOperation({ summary: 'Remove a member, or pass your own id to leave the album' })
  removeUser(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.albumService.removeUser(auth, id, userId === 'me' ? auth.user.id : userId);
  }

  @Put(':id/lock')
  @ApiOperation({ summary: 'Lock or unlock an album' })
  setLock(@Authed() auth: AuthDto, @Param('id') id: string, @Body() dto: SetAlbumLockDto) {
    if (!dto.isLocked) assertVaultUnlocked(auth);
    return this.albumService.setLock(auth, id, dto.isLocked);
  }

  // -- activity -------------------------------------------------------------

  @Auth({ sharedLink: true })
  @Get(':id/activity')
  listActivity(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Query('assetId') assetId?: string,
  ) {
    return this.albumService.listActivity(auth, id, assetId);
  }

  @Auth({ sharedLink: true })
  @Post(':id/activity')
  createActivity(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.albumService.createActivity(auth, id, dto);
  }

  @Delete(':id/activity/:activityId')
  deleteActivity(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Param('activityId') activityId: string,
  ) {
    return this.albumService.deleteActivity(auth, id, activityId);
  }
}
