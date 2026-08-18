import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthDto } from '../../common/auth.types';
import { Auth, Authed, AuthedUserId } from '../../common/decorators';
import { GeocodingService } from '../../infra/geo/geocoding.service';
import { JOB, QUEUE } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { AssetService, type UploadedFile as MulterFile } from './asset.service';
import { DuplicateService } from './duplicate.service';
import { UploadPriorityInterceptor } from './upload-priority.interceptor';
import {
  AssetQueryDto,
  BulkAssetIdsDto,
  BulkUpdateAssetsDto,
  CheckDuplicateDto,
  CheckUploadReceiptsDto,
  CompleteUploadBatchDto,
  DeleteAssetsDto,
  ShareAssetsDto,
  StackAssetsDto,
  UpdateAssetDto,
  UploadAssetDto,
} from './asset.dto';

@ApiTags('Assets')
@Auth()
@Controller('assets')
export class AssetController {
  constructor(
    private readonly assetService: AssetService,
    private readonly duplicates: DuplicateService,
    private readonly geocoding: GeocodingService,
    private readonly jobs: JobService,
  ) {}

  @Post('upload')
  @UseInterceptors(UploadPriorityInterceptor, FileInterceptor('assetData'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload one photo or video',
    description:
      'Duplicate content is detected by sha1 and returns the existing asset instead of storing it twice.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['assetData'],
      properties: {
        assetData: { type: 'string', format: 'binary' },
        uploadId: { type: 'string' },
        uploadBatchId: { type: 'string' },
        deferProcessing: { type: 'boolean' },
        deviceAssetId: { type: 'string' },
        deviceId: { type: 'string' },
        deviceName: { type: 'string', example: 'Eran’s iPhone' },
        devicePlatform: { type: 'string', example: 'ios' },
        fileCreatedAt: { type: 'string', format: 'date-time' },
        fileModifiedAt: { type: 'string', format: 'date-time' },
        isFavorite: { type: 'boolean' },
        folderId: { type: 'string', format: 'uuid' },
        relativePath: { type: 'string', example: '2024/Iceland/img_0001.jpg' },
        albumId: { type: 'string', format: 'uuid' },
        isLocked: { type: 'boolean' },
      },
    },
  })
  async upload(
    @AuthedUserId() userId: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body() dto: UploadAssetDto,
  ) {
    if (!file) throw new BadRequestException('No file was uploaded under the field "assetData"');
    return this.assetService.createFromUpload(userId, file, dto);
  }

  @Post('upload-status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm which web uploads committed after a lost response' })
  checkUploadReceipts(
    @AuthedUserId() userId: string,
    @Body() dto: CheckUploadReceiptsDto,
  ) {
    return this.assetService.checkUploadReceipts(userId, dto.uploadIds, {
      batchId: dto.uploadBatchId,
      deferProcessing: dto.deferProcessing,
    });
  }

  @Post('upload-complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start backend processing after a web upload batch is stored' })
  completeUploadBatch(
    @AuthedUserId() userId: string,
    @Body() dto: CompleteUploadBatchDto,
  ) {
    return this.assetService.completeUploadBatch(userId, dto.batchId, dto.assetIds);
  }

  @Post('thumbnail-status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check thumbnail readiness for a visible batch of media' })
  thumbnailStatus(@AuthedUserId() userId: string, @Body() dto: BulkAssetIdsDto) {
    return this.assetService.thumbnailStatus(userId, dto.ids);
  }

  @Post('check-duplicates')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask which checksums the server already has, before uploading' })
  checkDuplicates(@AuthedUserId() userId: string, @Body() dto: CheckDuplicateDto) {
    return this.assetService.checkDuplicates(userId, dto.checksums);
  }

  @Get('search/context')
  @ApiOperation({
    summary: 'Find photos by what is in them',
    description:
      'Compares the phrase against the pictures themselves. No keyword matching — the words need not appear anywhere in the file.',
  })
  searchByContext(
    @AuthedUserId() userId: string,
    @Query('text') text: string,
    @Query('size') size?: string,
  ) {
    return this.assetService.searchByContext(
      userId,
      text ?? '',
      size ? Math.min(500, Number.parseInt(size, 10)) : 200,
    );
  }

  @Get('search/places')
  @ApiOperation({ summary: 'Albums and folders matching a name, and what is inside them' })
  searchPlaces(@AuthedUserId() userId: string, @Query('text') text: string) {
    return this.assetService.searchPlaces(userId, text ?? '');
  }

  @Get('search/facets')
  @ApiOperation({ summary: 'Distinct places and cameras present in the library' })
  searchFacets(@AuthedUserId() userId: string) {
    return this.assetService.searchFacets(userId);
  }

  @Get('backed-up')
  @ApiOperation({
    summary: 'Device asset ids already backed up by this account',
    description:
      'Lets a freshly installed app tell which of the photos on the phone are already safe, instead of offering to send them all again.',
  })
  backedUp(@AuthedUserId() userId: string, @Query('deviceId') deviceId?: string) {
    return this.assetService.backedUpDeviceAssetIds(userId, deviceId);
  }

  @Get('places')
  @ApiOperation({
    summary: 'Places the library has photos in, most photographed first',
    description: 'Each carries a count, a cover photo and a coordinate to drop a pin on.',
  })
  places(@AuthedUserId() userId: string) {
    return this.assetService.places(userId);
  }

  @Get('map')
  @ApiOperation({
    summary: 'Every photo that has coordinates, as points',
    description: 'Id, latitude and longitude only — enough to plot and cluster, nothing more.',
  })
  mapPoints(@AuthedUserId() userId: string) {
    return this.assetService.mapPoints(userId);
  }

  @Get('places/status')
  @ApiOperation({ summary: 'How many photos still have coordinates but no place name' })
  async placesStatus(@AuthedUserId() userId: string) {
    const missing = await this.assetService.assetsMissingPlace(userId);
    return { enabled: this.geocoding.enabled, pending: missing.length };
  }

  @Post('places/backfill')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Name the places of photos uploaded before geocoding existed',
    description:
      'Rate-limited to one lookup a second by the geocoder, so a large library takes a while. Safe to call again; it only looks at photos still missing a name.',
  })
  async backfillPlaces(@AuthedUserId() userId: string) {
    const missing = await this.assetService.assetsMissingPlace(userId);
    await this.jobs.enqueueMany(
      QUEUE.METADATA,
      JOB.REVERSE_GEOCODE,
      missing.map(({ assetId }) => ({ assetId })),
    );
    return { queued: missing.length };
  }

  @Get('search/status')
  @ApiOperation({ summary: 'How much of the library has been described for content search' })
  searchStatus(@AuthedUserId() userId: string) {
    return this.assetService.searchIndexStatus(userId);
  }

  @Post('search/reindex')
  @HttpCode(200)
  @ApiOperation({ summary: 'Describe every photo that has not been indexed yet' })
  async reindex(@AuthedUserId() userId: string) {
    const assets = await this.assetService.assetsMissingSearchIndex(userId);
    await this.assetService.queueSearchIndexing(assets);
    return { queued: assets.length };
  }

  @Get('duplicates')
  @ApiOperation({
    summary: 'Groups of duplicate photos and videos',
    description:
      'Matched on file contents and on visual similarity, so a resized or renamed copy is still found. Never matched on file name alone.',
  })
  listDuplicates(@AuthedUserId() userId: string) {
    return this.duplicates.list(userId);
  }

  @Get('duplicates/count')
  @ApiOperation({ summary: 'Number of unresolved duplicate groups, for the sidebar badge' })
  countDuplicates(@AuthedUserId() userId: string) {
    return this.duplicates.count(userId);
  }

  @Post('duplicates/scan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-run detection across the whole library' })
  scanDuplicates(@AuthedUserId() userId: string) {
    return this.duplicates.detectForOwner(userId);
  }

  @Post('duplicates/:duplicateId/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a group as reviewed, keeping every asset in it' })
  resolveDuplicate(
    @AuthedUserId() userId: string,
    @Param('duplicateId') duplicateId: string,
  ) {
    return this.duplicates.resolve(userId, duplicateId);
  }

  @Get()
  @ApiOperation({ summary: 'Filtered, sorted, paginated assets' })
  query(@AuthedUserId() userId: string, @Query() query: AssetQueryDto) {
    return this.assetService.query(userId, query);
  }

  @Get('statistics')
  statistics(@AuthedUserId() userId: string) {
    return this.assetService.statistics(userId);
  }

  @Get('timeline/buckets')
  @ApiOperation({ summary: 'Per-month counts used to build the timeline scrubber' })
  buckets(@AuthedUserId() userId: string, @Query() query: AssetQueryDto) {
    return this.assetService.timelineBuckets(userId, query);
  }

  @Get('timeline/bucket')
  @ApiOperation({ summary: 'Every asset in one month bucket' })
  bucket(
    @AuthedUserId() userId: string,
    @Query('timeBucket') timeBucket: string,
    @Query() query: AssetQueryDto,
  ) {
    return this.assetService.timelineBucket(userId, timeBucket, query);
  }

  // -- trash ----------------------------------------------------------------

  @Get('trash')
  @ApiOperation({ summary: 'Trashed assets, each with the date it will be purged' })
  listTrash(
    @AuthedUserId() userId: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.assetService.listTrash(
      userId,
      page ? Number.parseInt(page, 10) : 1,
      size ? Number.parseInt(size, 10) : 250,
    );
  }

  @Post('trash/restore')
  @HttpCode(200)
  restore(@AuthedUserId() userId: string, @Body() dto: BulkAssetIdsDto) {
    return this.assetService.restore(userId, dto.ids);
  }

  @Post('trash/restore-all')
  @HttpCode(200)
  restoreAll(@AuthedUserId() userId: string) {
    return this.assetService.restoreAll(userId);
  }

  @Post('trash/empty')
  @HttpCode(200)
  @ApiOperation({ summary: 'Permanently delete everything in the trash' })
  emptyTrash(@AuthedUserId() userId: string) {
    return this.assetService.emptyTrash(userId);
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Move active assets to Trash, or permanently delete assets already in Trash',
  })
  remove(@AuthedUserId() userId: string, @Body() dto: DeleteAssetsDto) {
    return dto.force
      ? this.assetService.deletePermanently(userId, dto.ids)
      : this.assetService.trash(userId, dto.ids);
  }

  // -- editing --------------------------------------------------------------

  @Put('bulk')
  @ApiOperation({ summary: 'Favourite, archive or re-file many assets at once' })
  bulkUpdate(@AuthedUserId() userId: string, @Body() dto: BulkUpdateAssetsDto) {
    return this.assetService.bulkUpdate(userId, dto);
  }

  @Post('stack')
  stack(@AuthedUserId() userId: string, @Body() dto: StackAssetsDto) {
    return this.assetService.stack(userId, dto.primaryAssetId, dto.assetIds);
  }

  @Post('share')
  @ApiOperation({ summary: 'Share selected photos or videos with existing accounts' })
  share(@AuthedUserId() userId: string, @Body() dto: ShareAssetsDto) {
    return this.assetService.share(userId, dto);
  }

  @Get(':id/shares')
  @ApiOperation({ summary: 'Accounts with direct access to this asset' })
  sharedWith(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.assetService.sharedWith(userId, id);
  }

  @Delete(':id/shares/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke one account’s direct access to an asset' })
  revokeShare(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Param('userId') recipientId: string,
  ) {
    return this.assetService.removeShare(userId, id, recipientId);
  }

  @Delete('stack/:id')
  unstack(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.assetService.unstack(userId, id);
  }

  @Auth({ sharedLink: true })
  @Get(':id')
  get(@Authed() auth: AuthDto, @Param('id') id: string) {
    return this.assetService.getById(auth, id);
  }

  @Put(':id')
  update(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assetService.update(userId, id, dto);
  }
}
