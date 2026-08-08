import {
  Body,
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
import { StorageService } from '../../infra/storage/storage.service';
import { JOB, QUEUE } from '../../infra/job/job.constants';
import { JobService } from '../../infra/job/job.service';
import { MachineLearningService } from '../../infra/ml/ml.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FaceClusteringService } from './face-clustering.service';
import {
  AssetIdsDto,
  CreateSubjectDto,
  FaceIdsDto,
  MergePeopleDto,
  PersonQueryDto,
  ReassignFacesDto,
  SetCoverDto,
  UpdatePersonDto,
} from './person.dto';
import { PersonService } from './person.service';

@ApiTags('People')
@Auth()
@Controller('people')
export class PersonController {
  constructor(
    private readonly people: PersonService,
    private readonly clustering: FaceClusteringService,
    private readonly ml: MachineLearningService,
    private readonly jobs: JobService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'People found in the library, most photographed first' })
  list(@AuthedUserId() userId: string, @Query() query: PersonQueryDto) {
    return this.people.list(userId, query);
  }

  @Get('statistics')
  statistics(@AuthedUserId() userId: string) {
    return this.people.statistics(userId);
  }

  @Get('status')
  @ApiOperation({ summary: 'Whether face recognition is available and how far it has got' })
  async status(@AuthedUserId() userId: string) {
    // Everything a scan would look at, whether or not it has yet.
    const eligible = {
      ownerId: userId,
      type: 'IMAGE' as const,
      deletedAt: null,
      visibility: { not: 'LOCKED' as const },
    };

    const [ready, pending, total] = await Promise.all([
      this.ml.isReady(),
      this.prisma.asset.count({
        where: { ...eligible, jobStatus: { facesRecognizedAt: null } },
      }),
      // The denominator. A count of what is left says nothing on its own —
      // two hundred outstanding is nearly done in one library and barely
      // started in another.
      this.prisma.asset.count({ where: eligible }),
    ]);

    return { enabled: this.ml.enabled, ready, pendingAssets: pending, totalAssets: total };
  }

  @Post('scan')
  @ApiOperation({
    summary: 'Queue face detection for every photo that has not been scanned yet',
  })
  async scan(@AuthedUserId() userId: string) {
    if (!(await this.ml.isReady())) {
      // Better to say so than to queue work that will fail one job at a time.
      throw new ServiceUnavailableException(
        'The machine-learning service is not ready yet. It downloads its models on first start; try again in a minute.',
      );
    }

    const assets = await this.prisma.asset.findMany({
      where: {
        ownerId: userId,
        type: 'IMAGE',
        deletedAt: null,
        visibility: { not: 'LOCKED' },
        previewPath: { not: null },
        jobStatus: { facesRecognizedAt: null },
      },
      select: { id: true },
    });

    const ids = assets.map((asset) => asset.id);

    // A previous attempt that failed still owns its job id, so without this a
    // rescan after an outage would be quietly dropped as a duplicate.
    const retried = await this.jobs.releaseJobIds(QUEUE.FACE_DETECTION, JOB.DETECT_FACES, ids);

    await this.jobs.enqueueMany(
      QUEUE.FACE_DETECTION,
      JOB.DETECT_FACES,
      ids.map((assetId) => ({ assetId })),
    );

    return { queued: ids.length, retried };
  }

  @Post('recluster')
  @ApiOperation({
    summary: 'Regroup every face again',
    description:
      'Useful after changing the grouping threshold. Names and manual corrections are kept.',
  })
  async recluster(@AuthedUserId() userId: string) {
    await this.jobs.enqueue(QUEUE.FACE_CLUSTER, JOB.CLUSTER_FACES, { userId });
    return { queued: true };
  }

  @Get(':id/thumbnail.jpg')
  @ApiOperation({ summary: 'The cropped face used as this person’s avatar' })
  @Header('Cache-Control', 'private, max-age=86400')
  async thumbnailImage(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    // Goes through `get` first so one account cannot read another's crops by
    // guessing an id.
    const person = await this.people.get(userId, id);

    // Generated on demand the first time it is asked for: clustering can rename
    // and merge people long after detection ran, and regenerating every crop
    // eagerly on every change would be wasted work for people never viewed.
    let path = person.thumbnailPath;
    if (!path || !(await this.storage.exists(path))) {
      path = (await this.people.generateThumbnail(id)) ?? '';
    }

    if (!path) throw new NotFoundException('No face crop is available for this person yet');

    res.setHeader('Content-Type', 'image/jpeg');
    createReadStream(path).pipe(res);
  }

  @Get(':id')
  get(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.people.get(userId, id);
  }

  @Get(':id/assets')
  @ApiOperation({ summary: 'Photos this person appears in' })
  getAssets(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.people.getAssets(
      userId,
      id,
      page ? Number.parseInt(page, 10) : 1,
      size ? Number.parseInt(size, 10) : 250,
    );
  }

  @Put(':id')
  @ApiOperation({ summary: 'Name a person, hide them, or mark them a favourite' })
  update(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePersonDto,
  ) {
    return this.people.update(userId, id, dto);
  }

  @Post(':id/merge')
  @ApiOperation({ summary: 'Fold other people into this one' })
  merge(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: MergePeopleDto,
  ) {
    return this.people.merge(userId, id, dto.sourceIds);
  }

  @Post(':id/detach')
  @ApiOperation({ summary: 'Remove faces that are not this person' })
  detach(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: FaceIdsDto,
  ) {
    return this.people.detachFaces(userId, id, dto.faceIds);
  }

  @Post('faces/in-assets')
  @HttpCode(200)
  @ApiOperation({
    summary: 'The detections inside these photos',
    description:
      'Assigning works on detections, not photos, so the client needs to know which ones are there before it can move them.',
  })
  facesInAssets(@AuthedUserId() userId: string, @Body() dto: AssetIdsDto) {
    return this.people.facesInAssets(userId, dto.assetIds);
  }

  @Post()
  @ApiOperation({ summary: 'Start a new person or pet, for a face the grouping missed' })
  create(@AuthedUserId() userId: string, @Body() dto: CreateSubjectDto) {
    return this.people.create(userId, dto.name, dto.kind);
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
    return this.people.attachAssets(userId, id, dto.assetIds);
  }

  @Post('faces/reassign')
  @ApiOperation({ summary: 'Move specific faces onto another person' })
  reassign(@AuthedUserId() userId: string, @Body() dto: ReassignFacesDto) {
    return this.people.reassignFaces(userId, dto.faceIds, dto.personId);
  }

  @Put(':id/cover')
  @ApiOperation({ summary: 'Choose which of this person’s photos the avatar comes from' })
  setCover(
    @AuthedUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: SetCoverDto,
  ) {
    return this.people.setCover(userId, id, dto.assetId);
  }

  @Post(':id/thumbnail')
  @ApiOperation({ summary: 'Rebuild the avatar crop' })
  async thumbnail(@AuthedUserId() userId: string, @Param('id') id: string) {
    await this.people.get(userId, id);
    const path = await this.people.generateThumbnail(id);
    return { generated: Boolean(path) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Forget this grouping. The photos are untouched.' })
  remove(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.people.remove(userId, id);
  }
}
