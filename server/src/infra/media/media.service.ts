import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exiftool } from 'exiftool-vendored';
import ffmpeg from 'fluent-ffmpeg';
import { dirname } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { toBytes } from '../../common/bytes';
import type { AppConfig } from '../../config/configuration';
import { StorageService } from '../storage/storage.service';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImageRegion {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
  rotation: number;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number;
  fps: number | null;
  container: string;
}

export class MediaProcessingCancelledError extends Error {
  constructor() {
    super('Media processing cancelled');
    this.name = MediaProcessingCancelledError.name;
  }
}

type ProcessingContinuation = () => boolean | Promise<boolean>;

// sharp handles these directly. Anything else goes through ffmpeg first.
const SHARP_FORMATS = new Set([
  'jpeg', 'jpg', 'png', 'webp', 'gif', 'avif', 'tiff', 'tif', 'heif', 'heic', 'jp2', 'svg',
]);

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly storage: StorageService,
  ) {
    // Large panoramas and scanned TIFFs blow past sharp's default guard.
    sharp.cache({ memory: 32, files: 0, items: 50 });
    sharp.concurrency(1);
  }

  // -- images ---------------------------------------------------------------

  async getImageDimensions(path: string): Promise<ImageDimensions> {
    const meta = await sharp(path, { failOn: 'none' }).metadata();
    // EXIF orientations 5-8 swap the visual axes.
    const swapped = (meta.orientation ?? 1) >= 5;
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    return swapped ? { width: height, height: width } : { width, height };
  }

  /**
   * Writes the grid thumbnail and the larger viewer preview from one decode.
   * Returns the paths actually written.
   */
  async generateImageThumbnails(
    source: string,
    ownerId: string,
    assetId: string,
    shouldContinue?: ProcessingContinuation,
  ) {
    const { thumbnailSize, previewSize, quality, format } = this.config.get('thumbnail', {
      infer: true,
    });

    const thumbPath = this.storage.buildDerivativePath('thumb', ownerId, assetId);
    const previewPath = this.storage.buildDerivativePath('preview', ownerId, assetId);
    await this.storage.ensureDir(dirname(thumbPath));

    const pipelineFor = (size: number) =>
      sharp(source, { failOn: 'none', animated: false })
        // Honour the EXIF orientation flag, then drop it so viewers don't rotate twice.
        .rotate()
        .resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .withMetadata({ orientation: undefined });

    const encode = (instance: Sharp) =>
      format === 'jpeg'
        ? instance.jpeg({ quality, mozjpeg: true })
        : instance.webp({ quality, effort: 4 });

    // Sequential writes cap libvips at one decode/encode allocation. On NAS
    // hardware two parallel derivatives can double memory and file pressure
    // for no user-visible gain; the grid thumbnail is deliberately first.
    try {
      await this.assertProcessingContinues(shouldContinue);
      await encode(pipelineFor(thumbnailSize)).toFile(thumbPath);
      await this.assertProcessingContinues(shouldContinue);
      await encode(pipelineFor(previewSize)).toFile(previewPath);
      await this.assertProcessingContinues(shouldContinue);
    } catch (error) {
      await this.storage.removeMany([thumbPath, previewPath]);
      throw error;
    }

    return { thumbnailPath: thumbPath, previewPath };
  }

  /**
   * ThumbHash is a ~25 byte placeholder the clients can render instantly while
   * the real thumbnail is still in flight.
   */
  async generateThumbhash(source: string): Promise<Uint8Array<ArrayBuffer>> {
    const { data, info } = await sharp(source, { failOn: 'none' })
      .rotate()
      .resize(100, 100, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const hash = rgbaToThumbHash(info.width, info.height, new Uint8Array(data));
    return toBytes(hash);
  }

  canSharpDecode(extension: string) {
    return SHARP_FORMATS.has(extension.replace('.', '').toLowerCase());
  }

  /** Laplacian sharpness for one detected region, isolated from sharp backgrounds. */
  async regionSharpness(
    path: string,
    region: ImageRegion,
    dimensions: ImageDimensions,
  ): Promise<number> {
    const left = Math.max(0, Math.min(dimensions.width - 1, Math.floor(region.x1)));
    const top = Math.max(0, Math.min(dimensions.height - 1, Math.floor(region.y1)));
    const right = Math.max(left + 1, Math.min(dimensions.width, Math.ceil(region.x2)));
    const bottom = Math.max(top + 1, Math.min(dimensions.height, Math.ceil(region.y2)));
    const crop = await sharp(path, { failOn: 'none' })
      .extract({ left, top, width: right - left, height: bottom - top })
      .greyscale()
      .jpeg()
      .toBuffer();

    return (await sharp(crop, { failOn: 'none' }).stats()).sharpness;
  }

  /**
   * A 64-bit difference hash, as 16 hex characters.
   *
   * The image is reduced to a 9x8 greyscale grid and each pixel compared with
   * its right-hand neighbour, giving 8x8 = 64 bits describing the *gradients*
   * of the picture rather than its exact pixels. Two copies of the same photo
   * at different sizes, JPEG qualities, or file names produce hashes only a few
   * bits apart, while genuinely different photos land far away.
   *
   * dHash rather than average-hash: it is markedly less confused by an overall
   * brightness or contrast shift, which is exactly what re-exporting a photo
   * tends to do.
   */
  async perceptualHash(source: string): Promise<string> {
    const width = 9;
    const height = 8;

    const { data } = await sharp(source, { failOn: 'none' })
      .greyscale()
      // `fill` on purpose: preserving aspect ratio would let a crop of the same
      // photo hash identically to the original, which is a different picture.
      .resize(width, height, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let bits = 0n;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width - 1; column++) {
        const left = data[row * width + column];
        const right = data[row * width + column + 1];
        bits = (bits << 1n) | (left > right ? 1n : 0n);
      }
    }

    return bits.toString(16).padStart(16, '0');
  }

  /**
   * Converts anything sharp cannot open (RAW, exotic containers) into a JPEG
   * that the rest of the pipeline can work with.
   */
  async extractToJpeg(source: string, destination: string) {
    await this.storage.ensureDir(dirname(destination));

    // Most RAW files carry a camera-rendered JPEG. Prefer that portable,
    // full-colour preview before ffmpeg: recent Apple DNGs use tiled 10-bit RAW
    // data that ffmpeg cannot decode, while ExifTool exposes their 4032×3024
    // PreviewImage directly without changing the original file.
    for (const extract of [exiftool.extractPreview, exiftool.extractJpgFromRaw]) {
      try {
        await extract.call(exiftool, source, destination);
        const metadata = await sharp(destination, { failOn: 'none' }).metadata();
        if (metadata.width && metadata.height) return destination;
      } catch {
        // Not every RAW format carries every preview tag. Try the next source.
      }
      await this.storage.remove(destination);
    }

    return new Promise<string>((resolve, reject) => {
      ffmpeg(source)
        .outputOptions(['-frames:v 1', '-q:v 2'])
        .on('error', reject)
        .on('end', () => resolve(destination))
        .save(destination);
    });
  }

  // -- video ----------------------------------------------------------------

  probeVideo(path: string): Promise<VideoProbe> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(path, (error, data) => {
        if (error) return reject(error);

        const video = data.streams.find((s) => s.codec_type === 'video');
        const audio = data.streams.find((s) => s.codec_type === 'audio');
        const rotation = Math.abs(Number(video?.rotation ?? 0)) % 180;
        const width = video?.width ?? 0;
        const height = video?.height ?? 0;

        resolve({
          durationSeconds: Number(data.format.duration ?? 0),
          // A 90/270 degree rotation means the stored dimensions are transposed.
          width: rotation === 90 ? height : width,
          height: rotation === 90 ? width : height,
          rotation: Number(video?.rotation ?? 0),
          videoCodec: video?.codec_name ?? null,
          audioCodec: audio?.codec_name ?? null,
          bitrate: Number(data.format.bit_rate ?? 0),
          fps: this.parseFps(video?.r_frame_rate),
          container: data.format.format_name ?? '',
        });
      });
    });
  }

  private parseFps(rate?: string) {
    if (!rate) return null;
    const [num, den] = rate.split('/').map(Number);
    if (!num || !den) return null;
    return Math.round((num / den) * 100) / 100;
  }

  /** Grabs a still to use as the video's thumbnail source. */
  async extractPosterFrame(
    source: string,
    destination: string,
    atSeconds = 0,
    shouldContinue?: ProcessingContinuation,
  ) {
    await this.storage.ensureDir(dirname(destination));
    await this.assertProcessingContinues(shouldContinue);
    return this.runFfmpeg(
      ffmpeg(source)
        // Seeking before the input is far faster on long files.
        .inputOptions([`-ss ${atSeconds.toFixed(2)}`])
        // `-update 1` explicitly tells image2 this is one still rather than a
        // filename pattern. It also avoids FFmpeg 8's deprecated `-vsync` path.
        .outputOptions(['-frames:v 1', '-q:v 2', '-update 1']),
      destination,
      shouldContinue,
    );
  }

  /**
   * True when the original will already play in a browser and does not need a
   * second copy on disk.
   */
  needsTranscode(probe: VideoProbe): boolean {
    const cfg = this.config.get('ffmpeg', { infer: true });
    if (cfg.transcodePolicy === 'all') return true;
    if (cfg.transcodePolicy === 'none') return false;

    const webSafeVideo = ['h264', 'hevc', 'vp9', 'av1'].includes(probe.videoCodec ?? '');
    const webSafeAudio = !probe.audioCodec || ['aac', 'opus', 'mp3'].includes(probe.audioCodec);
    const container = probe.container.includes('mp4') || probe.container.includes('webm');
    const withinTarget = Math.min(probe.width, probe.height) <= cfg.targetResolution * 1.5;

    return !(webSafeVideo && webSafeAudio && container && withinTarget);
  }

  async transcodeVideo(
    source: string,
    destination: string,
    probe: VideoProbe,
    shouldContinue?: ProcessingContinuation,
  ) {
    const cfg = this.config.get('ffmpeg', { infer: true });
    await this.storage.ensureDir(dirname(destination));

    // Scale the short edge to the target, keep aspect, force even dimensions
    // because h264 requires them.
    const isPortrait = probe.height > probe.width;
    const scale = isPortrait
      ? `scale=${cfg.targetResolution}:-2`
      : `scale=-2:${cfg.targetResolution}`;

    await this.assertProcessingContinues(shouldContinue);
    return this.runFfmpeg(
      ffmpeg(source)
        .videoCodec(cfg.targetVideoCodec === 'hevc' ? 'libx265' : 'libx264')
        .audioCodec(cfg.targetAudioCodec === 'opus' ? 'libopus' : 'aac')
        .audioBitrate('128k')
        .outputOptions([
          `-crf ${cfg.crf}`,
          `-preset ${cfg.preset}`,
          `-threads ${cfg.threads}`,
          `-vf ${scale}`,
          '-pix_fmt yuv420p',
          // Put the index at the front so playback can start before the whole
          // file has been fetched.
          '-movflags +faststart',
          '-max_muxing_queue_size 1024',
        ])
        .on('start', (cmd) => this.logger.debug(`ffmpeg: ${cmd}`)),
      destination,
      shouldContinue,
    );
  }

  private async assertProcessingContinues(shouldContinue?: ProcessingContinuation) {
    if (shouldContinue && !(await shouldContinue())) throw new MediaProcessingCancelledError();
  }

  /** Stops a long FFmpeg child promptly when its asset enters Trash. */
  private runFfmpeg(
    command: ReturnType<typeof ffmpeg>,
    destination: string,
    shouldContinue?: ProcessingContinuation,
  ) {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let cancelled = false;
      let checking = false;
      const timer = shouldContinue
        ? setInterval(() => {
            if (settled || checking) return;
            checking = true;
            Promise.resolve(shouldContinue())
              .then((active) => {
                if (!active && !settled) {
                  cancelled = true;
                  command.kill('SIGKILL');
                }
              })
              .catch((error) => this.logger.warn(`Cancellation check failed: ${String(error)}`))
              .finally(() => {
                checking = false;
              });
          }, 500)
        : null;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearInterval(timer);
        operation();
      };

      command
        .on('error', (error) =>
          finish(() => reject(cancelled ? new MediaProcessingCancelledError() : error)),
        )
        .on('end', () => finish(() => resolve(destination)))
        .save(destination);
    });
  }
}
