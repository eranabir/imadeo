import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { assertVaultUnlocked } from '../../common/auth.guard';
import type { AuthDto } from '../../common/auth.types';
import { Auth, Authed, AuthedUserId } from '../../common/decorators';
import {
  CreateFolderDto,
  FolderAssetsDto,
  FolderContentsQueryDto,
  FolderTreeQueryDto,
  MoveFolderDto,
  ShareFolderDto,
  SetFolderLockDto,
  UpdateFolderDto,
} from './folder.dto';
import { FolderService } from './folder.service';

@ApiTags('Folders')
@Auth()
@Controller('folders')
export class FolderController {
  constructor(private readonly folderService: FolderService) {}

  @Get('tree')
  @ApiOperation({ summary: 'The complete nested folder tree for the current user' })
  getTree(@AuthedUserId() userId: string, @Query() query: FolderTreeQueryDto) {
    return this.folderService.getTree(userId, query);
  }

  @Get('root')
  @ApiOperation({ summary: 'Folders, albums and loose assets that sit at the top level' })
  getRoot(@AuthedUserId() userId: string, @Query() query: FolderContentsQueryDto) {
    return this.folderService.getContents(userId, null, query);
  }

  @Get('trash')
  @ApiOperation({ summary: 'Deleted folder trees that can be restored' })
  trash(@AuthedUserId() userId: string) {
    return this.folderService.listTrash(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a folder, optionally inside another folder' })
  create(@AuthedUserId() userId: string, @Body() dto: CreateFolderDto) {
    return this.folderService.create(userId, dto);
  }

  @Post('ensure-path')
  @ApiOperation({
    summary: 'Create a whole A/B/C chain at once, reusing folders that already exist',
  })
  ensurePath(
    @AuthedUserId() userId: string,
    @Body() body: { segments: string[]; rootId?: string | null },
  ) {
    return this.folderService.ensurePath(userId, body.segments ?? [], body.rootId ?? null);
  }

  @Post(':id/users')
  @ApiOperation({ summary: 'Share a folder and its complete subtree with other accounts' })
  share(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: ShareFolderDto,
  ) {
    return this.folderService.share(userId, id, dto.userIds);
  }

  @Delete(':id/users/:userId')
  @ApiOperation({ summary: 'Revoke an account’s access to a shared folder' })
  unshare(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Param('userId') recipientId: string,
  ) {
    return this.folderService.removeShare(userId, id, recipientId);
  }

  @Post(':id/convert-to-album')
  @ApiOperation({ summary: 'Replace a leaf folder with an album containing its direct photos' })
  convertToAlbum(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.folderService.convertToAlbum(userId, id);
  }

  @Get(':id')
  get(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.folderService.getById(userId, id);
  }

  @Get(':id/breadcrumbs')
  breadcrumbs(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.folderService.getBreadcrumbs(userId, id);
  }

  @Get(':id/contents')
  @ApiOperation({ summary: 'Sub-folders, albums and assets inside a folder' })
  contents(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Query() query: FolderContentsQueryDto,
  ) {
    return this.folderService.getContents(userId, id, query);
  }

  @Get(':id/processing-status')
  @ApiOperation({ summary: 'Thumbnail processing progress for media directly inside a folder' })
  processingStatus(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.folderService.processingStatus(userId, id);
  }

  @Put(':id')
  update(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFolderDto,
  ) {
    return this.folderService.update(userId, id, dto);
  }

  @Put(':id/move')
  @ApiOperation({ summary: 'Re-parent a folder; the entire subtree moves with it' })
  move(@AuthedUserId() userId: string, @Param('id') id: string, @Body() dto: MoveFolderDto) {
    return this.folderService.move(userId, id, dto.parentId ?? null);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a folder and its subtree; assets go to the trash' })
  remove(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Query('keepAssets', new ParseBoolPipe({ optional: true })) keepAssets?: boolean,
  ) {
    return this.folderService.remove(userId, id, { keepAssets });
  }

  @Post(':id/restore')
  restore(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.folderService.restore(userId, id);
  }

  @Delete(':id/permanent')
  @ApiOperation({ summary: 'Permanently remove a folder tree from Trash' })
  deletePermanently(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.folderService.deletePermanently(userId, id);
  }

  @Put(':id/assets')
  @ApiOperation({ summary: 'Move assets into this folder' })
  addAssets(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: FolderAssetsDto,
  ) {
    return this.folderService.addAssets(userId, id, dto.assetIds);
  }

  @Get(':id/assets/ids')
  @ApiOperation({ summary: 'Every live photo id directly inside this folder' })
  assetIds(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.folderService.getAssetIds(userId, id);
  }

  @Delete(':id/assets')
  @ApiOperation({ summary: 'Move media in this folder to Trash' })
  removeAssets(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: FolderAssetsDto,
  ) {
    return this.folderService.removeAssets(userId, id, dto.assetIds);
  }

  @Put(':id/lock')
  @ApiOperation({ summary: 'Lock or unlock a folder subtree' })
  setLock(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Body() dto: SetFolderLockDto,
  ) {
    if (!dto.isLocked) assertVaultUnlocked(auth);
    return this.folderService.setLock(auth.user.id, id, dto.isLocked);
  }
}
