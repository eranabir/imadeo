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
import { Auth, AuthedUserId } from '../../common/decorators';
import {
  CreateFolderDto,
  FolderAssetsDto,
  FolderContentsQueryDto,
  FolderTreeQueryDto,
  MoveFolderDto,
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

  @Put(':id/assets')
  @ApiOperation({ summary: 'Move assets into this folder' })
  addAssets(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: FolderAssetsDto,
  ) {
    return this.folderService.addAssets(userId, id, dto.assetIds);
  }

  @Delete(':id/assets')
  removeAssets(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: FolderAssetsDto,
  ) {
    return this.folderService.removeAssets(userId, id, dto.assetIds);
  }

  @Put(':id/lock')
  @Auth({ vault: true })
  @ApiOperation({ summary: 'Lock or unlock a folder subtree' })
  setLock(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: SetFolderLockDto,
  ) {
    return this.folderService.setLock(userId, id, dto.isLocked);
  }
}
