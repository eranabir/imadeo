import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { Auth, AuthedUserId } from '../../common/decorators';
import { mainLibraryAssetWhere } from '../../common/asset-scope';
import { AssetType } from '../../db';
import { StorageService } from '../../infra/storage/storage.service';
import { BackgroundTaskGate } from '../../infra/job/background-task-gate.service';
import { JOB, QUEUE } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { MachineLearningService } from '../../infra/ml/ml.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FaceClusteringService } from './face-clustering.service';
import {
  AssetIdsDto,
  CreateSubjectDto,
  FaceIdsDto,
  MergeSubjectsDto,
  SubjectQueryDto,
  ReassignFacesDto,
  SetCoverDto,
  SubjectIdsDto,
  UpdateSubjectDto,
} from './person.dto';
import { SubjectService } from './subject.service';

const unrecognisedAssets = (includePets: boolean) => ({
  OR: [
    { jobStatus: null },
    { jobStatus: { facesRecognizedAt: null } },
    ...(includePets ? [{ jobStatus: { petsRecognizedAt: null } }] : []),
  ],
});

@ApiTags('People & Pets')
@Auth()
@Controller(['people-and-pets', 'people'])
export class PeopleAndPetsController {
  constructor(
    private readonly subjects: SubjectService,
    private readonly clustering: FaceClusteringService,
    private readonly ml: MachineLearningService,
    private readonly jobs: JobService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly backgroundTasks: BackgroundTaskGate,
  ) {}

  @Get()
  @ApiOperation({ summary: 'People and pets found in the library, most photographed first' })
  list(@AuthedUserId() userId: string, @Query() query: SubjectQueryDto) {
    return this.subjects.list(userId, query);
  }

  @Get('statistics')
  statistics(@AuthedUserId() userId: string) {
    return this.subjects.statistics(userId);
  }

  @Get('status')
  @ApiOperation({ summary: 'Whether people and pet recognition is available and its progress' })
  async status(@AuthedUserId() userId: string) {
    const videosEnabled = this.ml.videoRecognitionEnabled;
    // Everything a scan would look at, whether or not it has yet.
    const eligible = {
      ...mainLibraryAssetWhere(userId),
      type: videosEnabled ? { in: [AssetType.IMAGE, AssetType.VIDEO] } : AssetType.IMAGE,
      previewPath: { not: null },
    };

    const [ready, petsReady, total, queue, activeBatch] = await Promise.all([
      this.ml.isFaceRecognitionReady(),
      this.ml.hasPets(),
      // The denominator. A count of what is left says nothing on its own —
      // two hundred outstanding is nearly done in one library and barely
      // started in another.
      this.prisma.asset.count({ where: eligible }),
      this.jobs.getQueueStatistics(QUEUE.FACE_DETECTION),
      this.prisma.recognitionBatch.findFirst({
        where: { ownerId: userId, completedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    ]);
    const pending = await this.prisma.asset.count({
      where: { ...eligible, ...unrecognisedAssets(petsReady) },
    });

    let scanTotalAssets = total;
    let scanPendingAssets = pending;
    if (activeBatch) {
      const batchEligible = {
        ...mainLibraryAssetWhere(userId),
        uploadBatchId: activeBatch.id,
        type: videosEnabled ? { in: [AssetType.IMAGE, AssetType.VIDEO] } : AssetType.IMAGE,
      };
      const [batchTotal, batchPending] = await Promise.all([
        this.prisma.asset.count({ where: batchEligible }),
        this.prisma.asset.count({
          where: { ...batchEligible, ...unrecognisedAssets(petsReady) },
        }),
      ]);
      if (batchTotal === 0 || batchPending === 0) {
        await this.prisma.recognitionBatch.update({
          where: { ownerId_id: { ownerId: userId, id: activeBatch.id } },
          data: { completedAt: new Date() },
        });
      } else {
        scanTotalAssets = batchTotal;
        scanPendingAssets = batchPending;
      }
    }

    const processingAssets =
      (await this.backgroundTasks.getSharedStatus()).activeQueues[QUEUE.FACE_DETECTION] ?? 0;
    const queuedAssets = queue.active + queue.waiting + queue.delayed;

    return {
      enabled: this.ml.faceRecognitionEnabled,
      videosEnabled,
      ready,
      petsReady,
      pendingAssets: pending,
      totalAssets: total,
      scanPendingAssets,
      scanTotalAssets,
      queuedAssets,
      // BullMQ can already own a job while it waits behind video or thumbnail
      // work. The scheduler is the authority for work that is truly using the
      // recognition service right now.
      processingAssets,
      scanning: processingAssets > 0,
    };
  }

  @Post('scan')
  @ApiOperation({
    summary: 'Queue people and pet detection for every eligible photo and video not scanned yet',
  })
  async scan(@AuthedUserId() userId: string, @Query('force') force?: string) {
    if (!(await this.ml.isFaceRecognitionReady())) {
      // Better to say so than to queue work that will fail one job at a time.
      throw new ServiceUnavailableException(
        'The machine-learning service is not ready yet. It downloads its models on first start; try again in a minute.',
      );
    }

    return this.queueScan(userId, force === 'true');
  }

  @Post('reset')
  @ApiOperation({
    summary: 'Delete every people and pet result for this account and rescan all media',
    description: 'Photos and videos are untouched. Names, merges and manual corrections are removed.',
  })
  async reset(@AuthedUserId() userId: string) {
    if (!(await this.ml.isFaceRecognitionReady())) {
      throw new ServiceUnavailableException(
        'The machine-learning service is not ready yet. Try again in a minute.',
      );
    }

    const [detectionQueue, clusterQueue] = await Promise.all([
      this.jobs.getQueueStatistics(QUEUE.FACE_DETECTION),
      this.jobs.getQueueStatistics(QUEUE.FACE_CLUSTER),
    ]);
    const queued =
      detectionQueue.active +
      detectionQueue.waiting +
      detectionQueue.delayed +
      clusterQueue.active +
      clusterQueue.waiting +
      clusterQueue.delayed;
    if (queued > 0) {
      throw new ConflictException('Wait for the current recognition scan to finish first.');
    }

    const removed = await this.subjects.resetRecognition(userId);
    const scan = await this.queueScan(userId, true);
    return { ...removed, ...scan };
  }

  private async queueScan(userId: string, scanEverything: boolean) {
    const petsReady = await this.ml.hasPets();
    const assets = await this.prisma.asset.findMany({
      where: {
        ...mainLibraryAssetWhere(userId),
        type: this.ml.videoRecognitionEnabled
          ? { in: [AssetType.IMAGE, AssetType.VIDEO] }
          : AssetType.IMAGE,
        previewPath: { not: null },
        ...(scanEverything ? {} : unrecognisedAssets(petsReady)),
      },
      select: { id: true, type: true },
    });

    const ids = assets.map((asset) => asset.id);
    const photoIds = assets
      .filter((asset) => asset.type === AssetType.IMAGE)
      .map((asset) => asset.id);
    const videoIds = assets
      .filter((asset) => asset.type === AssetType.VIDEO)
      .map((asset) => asset.id);

    // A deliberate re-scan must look pending while its jobs are running.
    // Otherwise the UI sees zero outstanding work immediately and keeps the
    // previous People & Pets groups on screen until a manual refresh.
    if (scanEverything && ids.length > 0) {
      await this.prisma.assetJobStatus.updateMany({
        where: { assetId: { in: ids } },
        data: { facesRecognizedAt: null, petsRecognizedAt: null },
      });
    }

    // A previous attempt that failed still owns its job id, so without this a
    // rescan after an outage would be quietly dropped as a duplicate.
    const retried = await this.jobs.releaseJobIds(QUEUE.FACE_DETECTION, JOB.DETECT_FACES, ids);

    await this.jobs.enqueueMany(
      QUEUE.FACE_DETECTION,
      JOB.DETECT_FACES,
      photoIds.map((assetId) => ({ assetId })),
    );
    await this.jobs.enqueueMany(
      QUEUE.FACE_DETECTION,
      JOB.DETECT_FACES,
      videoIds.map((assetId) => ({ assetId })),
      20,
    );

    if (ids.length > 0) {
      await this.jobs.releaseJobIds(QUEUE.FACE_CLUSTER, JOB.CLUSTER_FACES, [userId]);
      await this.jobs.enqueue(QUEUE.FACE_CLUSTER, JOB.CLUSTER_FACES, { userId });
    }

    return { queued: ids.length, retried, forced: scanEverything };
  }

  @Post('recluster')
  @ApiOperation({
    summary: 'Regroup every recognized person and pet again',
    description:
      'Useful after changing the grouping threshold. Names and manual corrections are kept.',
  })
  async recluster(@AuthedUserId() userId: string) {
    await this.jobs.releaseJobIds(QUEUE.FACE_CLUSTER, JOB.CLUSTER_FACES, [userId]);
    await this.jobs.enqueue(QUEUE.FACE_CLUSTER, JOB.CLUSTER_FACES, { userId });
    return { queued: true };
  }

  @Delete()
  @ApiOperation({ summary: 'Forget several people or pet groupings. Media is untouched.' })
  removeMany(@AuthedUserId() userId: string, @Body() dto: SubjectIdsDto) {
    return this.subjects.removeMany(userId, dto.subjectIds);
  }

  @Get(':id/thumbnail.jpg')
  @ApiOperation({ summary: 'The crop used as this subject’s avatar' })
  @Header('Cache-Control', 'private, no-cache')
  async thumbnailImage(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    // Goes through `get` first so one account cannot read another's crops by
    // guessing an id.
    const subject = await this.subjects.get(userId, id);

    // Generated on demand the first time it is asked for: clustering can rename
    // and merge people long after detection ran, and regenerating every crop
    // eagerly on every change would be wasted work for people never viewed.
    let path = subject.thumbnailPath;
    if (!path || !(await this.storage.exists(path))) {
      path = (await this.subjects.generateThumbnail(id)) ?? '';
    }

    if (!path) throw new NotFoundException('No avatar crop is available for this subject yet');

    res.setHeader('Content-Type', 'image/jpeg');
    createReadStream(path).pipe(res);
  }

  @Get(':id')
  get(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.subjects.get(userId, id);
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'Media this person or pet appears in' })
  getAssets(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.subjects.getAssets(
      userId,
      id,
      page ? Number.parseInt(page, 10) : 1,
      size ? Number.parseInt(size, 10) : 250,
    );
  }

  @Put(':id')
  @ApiOperation({ summary: 'Name, hide, favourite, or classify a person or pet' })
  update(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.subjects.update(userId, id, dto);
  }

  @Post(':id/merge')
  @ApiOperation({ summary: 'Merge other matching subjects into this person or pet' })
  merge(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: MergeSubjectsDto,
  ) {
    return this.subjects.merge(userId, id, dto.sourceIds);
  }

  @Post(':id/detach')
  @ApiOperation({ summary: 'Remove detections that are not this person or pet' })
  detach(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: FaceIdsDto,
  ) {
    return this.subjects.detachFaces(userId, id, dto.faceIds);
  }

  @Post('faces/in-assets')
  @HttpCode(200)
  @ApiOperation({
    summary: 'The detections inside these photos',
    description:
      'Assigning works on detections, not photos, so the client needs to know which ones are there before it can move them.',
  })
  facesInAssets(@AuthedUserId() userId: string, @Body() dto: AssetIdsDto) {
    return this.subjects.facesInAssets(userId, dto.assetIds);
  }

  @Post()
  @ApiOperation({ summary: 'Create a person or pet that recognition missed' })
  create(@AuthedUserId() userId: string, @Body() dto: CreateSubjectDto) {
    return this.subjects.create(userId, dto.name, dto.kind);
  }

  @Post(':id/assets')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Say these photos are of this person or pet',
    description:
      'Works whether or not anything was detected — a photo the models missed gets a manual entry.',
  })
  attachAssets(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: AssetIdsDto,
  ) {
    return this.subjects.attachAssets(userId, id, dto.assetIds);
  }

  @Post('faces/reassign')
  @ApiOperation({ summary: 'Move specific detections onto another person or pet' })
  reassign(@AuthedUserId() userId: string, @Body() dto: ReassignFacesDto) {
    return this.subjects.reassignFaces(userId, dto.faceIds, dto.personId);
  }

  @Put(':id/cover')
  @ApiOperation({ summary: 'Choose which photo supplies this subject’s avatar' })
  setCover(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: SetCoverDto,
  ) {
    return this.subjects.setCover(userId, id, dto.assetId);
  }

  @Post(':id/thumbnail')
  @ApiOperation({ summary: 'Rebuild the avatar crop' })
  async thumbnail(@AuthedUserId() userId: string, @Param('id') id: string) {
    await this.subjects.get(userId, id);
    const path = await this.subjects.generateThumbnail(id);
    return { generated: Boolean(path) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Forget this grouping. The media is untouched.' })
  remove(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.subjects.remove(userId, id);
  }
}
