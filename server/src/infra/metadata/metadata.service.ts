import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { type Tags, exiftool } from 'exiftool-vendored';
import { DateTime } from 'luxon';

export interface ExtractedMetadata {
  make: string | null;
  model: string | null;
  lensModel: string | null;
  width: number | null;
  height: number | null;
  orientation: string | null;
  dateTimeOriginal: Date | null;
  modifyDate: Date | null;
  timeZone: string | null;
  fNumber: number | null;
  focalLength: number | null;
  iso: number | null;
  exposureTime: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string;
  rating: number | null;
  fps: number | null;
  bitsPerSample: number | null;
  colorspace: string | null;
  profileDescription: string | null;
  projectionType: string | null;
  durationSeconds: number | null;
  /** Identifier linking an iOS live photo's still and video halves. */
  livePhotoCID: string | null;
}

@Injectable()
export class MetadataService implements OnModuleDestroy {
  private readonly logger = new Logger(MetadataService.name);

  async onModuleDestroy() {
    // exiftool runs as a long-lived child process; leaving it behind would keep
    // the node process alive on shutdown.
    await exiftool.end().catch(() => undefined);
  }

  async extract(path: string): Promise<ExtractedMetadata> {
    let tags: Tags;
    try {
      tags = await exiftool.read(path);
    } catch (error) {
      this.logger.warn(`Could not read metadata from ${path}: ${(error as Error).message}`);
      tags = {} as Tags;
    }

    const timeZone = this.pickTimeZone(tags);

    return {
      make: this.str(tags.Make),
      model: this.str(tags.Model),
      lensModel: this.str(tags.LensModel ?? (tags as Record<string, unknown>).LensID),
      width: this.num(tags.ImageWidth ?? tags.ExifImageWidth),
      height: this.num(tags.ImageHeight ?? tags.ExifImageHeight),
      orientation: tags.Orientation === undefined ? null : String(tags.Orientation),
      dateTimeOriginal: this.pickCaptureDate(tags, timeZone),
      modifyDate: this.toDate(tags.ModifyDate, timeZone),
      timeZone,
      fNumber: this.num(tags.FNumber),
      focalLength: this.num(tags.FocalLength),
      iso: this.num(tags.ISO),
      exposureTime: this.str(tags.ExposureTime),
      latitude: this.coord(tags.GPSLatitude),
      longitude: this.coord(tags.GPSLongitude),
      description:
        this.str(
          tags.Description ??
            tags.ImageDescription ??
            (tags as Record<string, unknown>).Caption,
        ) ?? '',
      rating: this.num(tags.Rating),
      fps: this.num((tags as Record<string, unknown>).VideoFrameRate),
      bitsPerSample: this.num(tags.BitsPerSample),
      colorspace: this.str(tags.ColorSpace),
      profileDescription: this.str(tags.ProfileDescription),
      projectionType: this.str((tags as Record<string, unknown>).ProjectionType),
      durationSeconds: this.duration(tags),
      livePhotoCID: this.str(
        (tags as Record<string, unknown>).ContentIdentifier ??
          (tags as Record<string, unknown>).MediaGroupUUID,
      ),
    };
  }

  /**
   * The capture instant, preferring tags that actually carry a timezone.
   * Falls back through the usual ladder before giving up.
   */
  private pickCaptureDate(tags: Tags, timeZone: string | null): Date | null {
    const candidates = [
      tags.SubSecDateTimeOriginal,
      tags.DateTimeOriginal,
      tags.SubSecCreateDate,
      tags.CreateDate,
      (tags as Record<string, unknown>).CreationDate,
      (tags as Record<string, unknown>).MediaCreateDate,
      tags.DateTimeCreated,
    ];

    for (const candidate of candidates) {
      const parsed = this.toDate(candidate, timeZone);
      if (parsed) return parsed;
    }
    return null;
  }

  /**
   * Where the photo was taken, as an IANA zone when we can get one. This is what
   * lets the timeline group an evening shot in Tokyo onto the Tokyo day rather
   * than the server's.
   */
  private pickTimeZone(tags: Tags): string | null {
    const zone = this.str(tags.tz);
    if (zone) return zone;

    // Fall back to a fixed offset when only OffsetTime is present.
    const offset = this.str(tags.OffsetTimeOriginal ?? tags.OffsetTime);
    if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) {
      return `UTC${offset}`;
    }
    return null;
  }

  private toDate(value: unknown, timeZone: string | null): Date | null {
    if (!value) return null;

    // exiftool-vendored hands back its own ExifDateTime objects.
    const maybe = value as { toDate?: () => Date; toISOString?: () => string };
    if (typeof maybe.toDate === 'function') {
      const date = maybe.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'string') {
      // EXIF writes "2024:06:12 18:04:31" rather than ISO 8601.
      const normalised = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
      const parsed = DateTime.fromISO(normalised, { zone: timeZone ?? 'utc' });
      return parsed.isValid ? parsed.toJSDate() : null;
    }

    return null;
  }

  private duration(tags: Tags): number | null {
    const raw = (tags as Record<string, unknown>).Duration ?? (tags as Record<string, unknown>).MediaDuration;
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'number') return raw;

    // Sometimes "0:00:12" and sometimes "12.34 s".
    const text = String(raw);
    const clock = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(text);
    if (clock) {
      return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    }
    const seconds = Number.parseFloat(text);
    return Number.isFinite(seconds) ? seconds : null;
  }

  private coord(value: unknown): number | null {
    const parsed = this.num(value);
    if (parsed === null) return null;
    // 0,0 in the Gulf of Guinea is what a camera writes when it has no fix.
    if (parsed === 0) return null;
    return Math.abs(parsed) > 180 ? null : parsed;
  }

  private num(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private str(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
  }
}
