import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { DateTime } from 'luxon';
import type { AppConfig } from '../../../config/configuration';
import { AssetType } from '../../../db';
import { JOB, QUEUE, type AssetJobData } from '../../../infra/job/job.constants';
import { JobService } from '../../../infra/job/job.service';
import { MediaService } from '../../../infra/media/media.service';
import { MetadataService } from '../../../infra/metadata/metadata.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/**
 * First stage of the pipeline. Reads EXIF, works out the true capture time in
 * the photo's own timezone, then hands off to thumbnail generation.
 */
@Processor(QUEUE.METADATA, { concurrency: 5 })
export class MetadataProcessor extends WorkerHost {
  private readonly logger = new Logger(MetadataProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metadata: MetadataService,
    private readonly media: MediaService,
    private readonly jobs: JobService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    const asset = await this.prisma.asset.findUnique({ where: { id: job.data.assetId } });
    if (!asset) return { skipped: 'asset gone' };

    const tags = await this.metadata.extract(asset.originalPath);

    let width = tags.width;
    let height = tags.height;
    let duration = asset.duration;
    let fps = tags.fps;

    if (asset.type === AssetType.VIDEO) {
      try {
        const probe = await this.media.probeVideo(asset.originalPath);
        width = probe.width || width;
        height = probe.height || height;
        fps = probe.fps ?? fps;
        duration = this.formatDuration(probe.durationSeconds);
      } catch (error) {
        this.logger.warn(`ffprobe failed for ${asset.id}: ${(error as Error).message}`);
      }
    } else if (!width || !height) {
      try {
        const dims = await this.media.getImageDimensions(asset.originalPath);
        width = dims.width;
        height = dims.height;
      } catch {
        // Leave the dimensions null; the thumbnail stage will report the real problem.
      }
    }

    const captured = tags.dateTimeOriginal ?? asset.fileCreatedAt;
    const localDateTime = this.toLocalDateTime(captured, tags.timeZone);

    await this.prisma.$transaction([
      this.prisma.assetExif.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          make: tags.make,
          model: tags.model,
          lensModel: tags.lensModel,
          exifImageWidth: width,
          exifImageHeight: height,
          orientation: tags.orientation,
          dateTimeOriginal: tags.dateTimeOriginal,
          modifyDate: tags.modifyDate,
          timeZone: tags.timeZone,
          fNumber: tags.fNumber,
          focalLength: tags.focalLength,
          iso: tags.iso,
          exposureTime: tags.exposureTime,
          latitude: tags.latitude,
          longitude: tags.longitude,
          description: tags.description,
          rating: tags.rating,
          fps,
          bitsPerSample: tags.bitsPerSample,
          colorspace: tags.colorspace,
          profileDescription: tags.profileDescription,
          projectionType: tags.projectionType,
        },
        update: {
          make: tags.make,
          model: tags.model,
          lensModel: tags.lensModel,
          exifImageWidth: width,
          exifImageHeight: height,
          orientation: tags.orientation,
          dateTimeOriginal: tags.dateTimeOriginal,
          modifyDate: tags.modifyDate,
          timeZone: tags.timeZone,
          fNumber: tags.fNumber,
          focalLength: tags.focalLength,
          iso: tags.iso,
          exposureTime: tags.exposureTime,
          latitude: tags.latitude,
          longitude: tags.longitude,
          rating: tags.rating,
          fps,
        },
      }),
      this.prisma.asset.update({
        where: { id: asset.id },
        data: {
          fileCreatedAt: captured,
          localDateTime,
          duration,
        },
      }),
      this.prisma.assetJobStatus.upsert({
        where: { assetId: asset.id },
        create: { assetId: asset.id, metadataExtractedAt: new Date() },
        update: { metadataExtractedAt: new Date() },
      }),
    ]);

    // Pair up an iOS live photo with its motion half.
    if (tags.livePhotoCID) {
      await this.linkLivePhoto(asset.id, asset.ownerId, tags.livePhotoCID, asset.type);
    }

    await this.jobs.enqueue(QUEUE.THUMBNAIL, JOB.GENERATE_THUMBNAILS, { assetId: asset.id });

    return { width, height, capturedAt: localDateTime.toISOString() };
  }

  /**
   * Shifts an instant into the zone the photo was taken in, then stores it as a
   * naive local time. Grouping the timeline on this is what keeps an evening
   * shot in Tokyo on the Tokyo day rather than the server's.
   */
  private toLocalDateTime(captured: Date, timeZone: string | null): Date {
    if (!timeZone) return captured;
    const shifted = DateTime.fromJSDate(captured).setZone(timeZone);
    if (!shifted.isValid) return captured;
    return new Date(
      Date.UTC(
        shifted.year,
        shifted.month - 1,
        shifted.day,
        shifted.hour,
        shifted.minute,
        shifted.second,
      ),
    );
  }

  private formatDuration(seconds: number) {
    const total = Math.max(0, Math.floor(seconds));
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    const ms = String(Math.round((seconds - total) * 1000)).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  }

  /**
   * iOS uploads the still and the motion clip as two files sharing a
   * ContentIdentifier. Join them so the pair shows as one live photo.
   */
  private async linkLivePhoto(assetId: string, ownerId: string, cid: string, type: AssetType) {
    const counterpart = await this.prisma.asset.findFirst({
      where: {
        ownerId,
        id: { not: assetId },
        type: type === AssetType.IMAGE ? AssetType.VIDEO : AssetType.IMAGE,
        exif: { autoStackId: cid },
      },
      select: { id: true },
    });

    await this.prisma.assetExif.update({
      where: { assetId },
      data: { autoStackId: cid },
    });

    if (!counterpart) return;

    const stillId = type === AssetType.IMAGE ? assetId : counterpart.id;
    const videoId = type === AssetType.IMAGE ? counterpart.id : assetId;

    await this.prisma.$transaction([
      this.prisma.asset.update({
        where: { id: stillId },
        data: { livePhotoVideoId: videoId },
      }),
      // The motion half should never appear on its own in the timeline.
      this.prisma.asset.update({
        where: { id: videoId },
        data: { visibility: 'HIDDEN' },
      }),
    ]);
  }
}
