import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { DateTime } from 'luxon';
import type { AppConfig } from '../../../config/configuration';
import { AssetType } from '../../../db';
import { JOB, QUEUE, type AssetJobData } from '../../../infra/job/job.constants';
import { GeocodingService } from '../../../infra/geo/geocoding.service';
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
    private readonly geocoding: GeocodingService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    super();
  }

  async process(job: Job<AssetJobData>) {
    // Naming a place needs no file read at all — the coordinates are already in
    // the database. Sharing the queue keeps it behind the same concurrency
    // limit as everything else touching EXIF.
    if (job.name === JOB.REVERSE_GEOCODE) return this.reverseGeocode(job.data.assetId);

    const asset = await this.prisma.asset.findUnique({ where: { id: job.data.assetId } });
    if (!asset) return { skipped: 'asset gone' };
    if (asset.deletedAt) return { skipped: 'asset deleted' };

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

    /**
     * The name of the place the coordinates point at.
     *
     * Done here rather than in its own job because it is the only thing that
     * turns a photo into one you can find by asking for a city, and it has to
     * be written in the same upsert as the coordinates it came from — two
     * writes would leave a window where a photo has a location and no name.
     *
     * The lookup is rate-limited inside the service and never throws, so the
     * worst case is a photo with coordinates and no place, which is exactly
     * what every photo had before this existed.
     */
    const place =
      tags.latitude !== null && tags.longitude !== null
        ? await this.geocoding.lookup(tags.latitude, tags.longitude)
        : null;

    // Metadata extraction and geocoding can take long enough for the user to
    // trash the asset while this job is active. Do not write or start the next
    // stage after that deletion event.
    if (!(await this.assetStillActive(asset.id))) return { skipped: 'asset deleted' };

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
          city: place?.city ?? null,
          state: place?.state ?? null,
          country: place?.country ?? null,
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
          city: place?.city ?? null,
          state: place?.state ?? null,
          country: place?.country ?? null,
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

    // Preserve the shared identifier, but keep both source files visible. The
    // application is a backup: processing must never turn two stored files into
    // one visible item without an explicit grouping UI.
    if (tags.livePhotoCID) {
      await this.recordLivePhotoIdentifier(asset.id, tags.livePhotoCID);
    }

    await this.jobs.enqueue(QUEUE.THUMBNAIL, JOB.GENERATE_THUMBNAILS, { assetId: asset.id });

    return { width, height, capturedAt: localDateTime.toISOString() };
  }

  /**
   * Names the place of one photo that already has coordinates.
   *
   * For everything uploaded before geocoding existed. Reads no file and touches
   * no other column, so running it over a whole library changes nothing except
   * the three fields it is there to fill.
   */
  private async reverseGeocode(assetId: string) {
    if (!(await this.assetStillActive(assetId))) return { skipped: 'asset deleted' };
    const exif = await this.prisma.assetExif.findUnique({
      where: { assetId },
      select: { latitude: true, longitude: true, city: true },
    });

    if (!exif?.latitude || !exif.longitude) return { skipped: 'no coordinates' };
    // Another run may have got here first; a second lookup would spend a second
    // of the rate limit to write what is already there.
    if (exif.city) return { skipped: 'already named' };

    const place = await this.geocoding.lookup(exif.latitude, exif.longitude);
    if (!place) return { skipped: 'no place found' };

    await this.prisma.assetExif.update({
      where: { assetId },
      data: { city: place.city, state: place.state, country: place.country },
    });

    return { city: place.city, country: place.country };
  }

  private async assetStillActive(assetId: string) {
    return Boolean(
      await this.prisma.asset.findFirst({
        where: { id: assetId, deletedAt: null },
        select: { id: true },
      }),
    );
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

  /** Retains Live Photo metadata without hiding or coupling either source file. */
  private recordLivePhotoIdentifier(assetId: string, cid: string) {
    return this.prisma.assetExif.update({
      where: { assetId },
      data: { autoStackId: cid },
    });
  }
}
