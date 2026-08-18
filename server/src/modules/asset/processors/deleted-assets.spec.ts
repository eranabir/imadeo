import { describe, expect, it, vi } from 'vitest';
import { JOB, QUEUE } from '../../../infra/job/job.constants';
import { FaceDetectionProcessor } from '../../person/face.processor';
import { ClipProcessor } from './clip.processor';
import { DuplicateProcessor } from './duplicate.processor';
import { MetadataProcessor } from './metadata.processor';
import { ThumbnailProcessor } from './thumbnail.processor';
import { VideoProcessor } from './video.processor';

const job = (name: string, queueName?: string) =>
  ({ name, queueName, data: { assetId: 'deleted-id' } }) as never;
const deletedImage = { id: 'deleted-id', type: 'IMAGE', deletedAt: new Date() };

describe('deleted asset processing', () => {
  it('skips every queued image-processing stage before reading the file', async () => {
    const prisma = { asset: { findUnique: vi.fn().mockResolvedValue(deletedImage) } };
    const extract = vi.fn();
    const thumbnails = vi.fn();
    const encodeImage = vi.fn();
    const detectDuplicates = vi.fn();
    const detectFaces = vi.fn();
    const backgroundTasks = {
      runMachineLearning: vi.fn(async (operation: () => Promise<unknown>) => operation()),
      runThumbnail: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    };

    const metadata = new MetadataProcessor(
      prisma as never,
      { extract } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const thumbnail = new ThumbnailProcessor(
      prisma as never,
      { generateImageThumbnails: thumbnails } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      backgroundTasks as never,
    );
    const clip = new ClipProcessor(
      prisma as never,
      { encodeImage } as never,
      backgroundTasks as never,
    );
    const duplicate = new DuplicateProcessor(
      {
        asset: {
          findUnique: vi.fn().mockResolvedValue({ ownerId: 'owner-id', deletedAt: new Date() }),
        },
      } as never,
      { detectForOwner: detectDuplicates } as never,
    );
    const face = new FaceDetectionProcessor(
      prisma as never,
      { detectFaces } as never,
      {} as never,
      {} as never,
      {} as never,
      backgroundTasks as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(metadata.process(job(JOB.EXTRACT_METADATA))).resolves.toEqual({
      skipped: 'asset deleted',
    });
    await expect(thumbnail.process(job(JOB.GENERATE_THUMBNAILS))).resolves.toEqual({
      skipped: 'asset deleted',
    });
    await expect(clip.process(job(JOB.ENCODE_CLIP))).resolves.toEqual({
      skipped: 'asset deleted',
    });
    await expect(duplicate.process(job(JOB.DETECT_DUPLICATES))).resolves.toEqual({
      skipped: 'asset deleted',
    });
    await expect(face.process(job(JOB.DETECT_FACES))).resolves.toEqual({
      skipped: 'asset deleted',
    });
    expect(extract).not.toHaveBeenCalled();
    expect(thumbnails).not.toHaveBeenCalled();
    expect(encodeImage).not.toHaveBeenCalled();
    expect(detectDuplicates).not.toHaveBeenCalled();
    expect(detectFaces).not.toHaveBeenCalled();
  });

  it('skips deleted videos before probing or transcoding', async () => {
    const probeVideo = vi.fn();
    const processor = new VideoProcessor(
      {
        asset: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'deleted-id',
            type: 'VIDEO',
            deletedAt: new Date(),
          }),
        },
      } as never,
      { probeVideo } as never,
      {} as never,
      {} as never,
    );

    await expect(processor.process(job(JOB.TRANSCODE_VIDEO))).resolves.toEqual({
      skipped: 'asset deleted',
    });
    expect(probeVideo).not.toHaveBeenCalled();
  });

  it('runs video poster generation on the video worker', async () => {
    const processThumbnail = vi.fn().mockResolvedValue({ thumbnailPath: '/preview.webp' });
    const processor = new VideoProcessor(
      {} as never,
      {} as never,
      {} as never,
      { process: processThumbnail } as never,
    );

    await expect(processor.process(job(JOB.GENERATE_THUMBNAILS))).resolves.toEqual({
      thumbnailPath: '/preview.webp',
    });
    expect(processThumbnail).toHaveBeenCalledOnce();
  });

  it('moves video poster jobs left by older releases off the image worker', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const extractPosterFrame = vi.fn();
    const processor = new ThumbnailProcessor(
      {
        asset: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'deleted-id',
            type: 'VIDEO',
            deletedAt: null,
          }),
        },
      } as never,
      { extractPosterFrame } as never,
      {} as never,
      { enqueue } as never,
      {} as never,
      {} as never,
      { runThumbnail: vi.fn() } as never,
    );

    await expect(
      processor.process(job(JOB.GENERATE_THUMBNAILS, QUEUE.THUMBNAIL)),
    ).resolves.toEqual({ queued: 'video worker' });
    expect(enqueue).toHaveBeenCalledWith(QUEUE.VIDEO, JOB.GENERATE_THUMBNAILS, {
      assetId: 'deleted-id',
    });
    expect(extractPosterFrame).not.toHaveBeenCalled();
  });
});

describe('upload priority', () => {
  it('waits for uploads to become idle before starting machine-learning work', async () => {
    let releaseUpload: () => void = () => undefined;
    const uploadIdle = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const runMachineLearning = vi.fn(async (operation: () => Promise<unknown>) => {
      await uploadIdle;
      return operation();
    });
    const encodeImage = vi.fn().mockResolvedValue([0.1]);
    const prisma = {
      asset: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'active-id',
          deletedAt: null,
          visibility: 'TIMELINE',
          previewPath: '/preview.webp',
          originalPath: '/original.jpg',
        }),
        findFirst: vi.fn().mockResolvedValue({ id: 'active-id' }),
      },
      $executeRaw: vi.fn().mockResolvedValue(1),
      assetJobStatus: { upsert: vi.fn().mockResolvedValue(undefined) },
    };
    const processor = new ClipProcessor(
      prisma as never,
      { encodeImage } as never,
      { runMachineLearning } as never,
    );

    const processing = processor.process({ data: { assetId: 'active-id' } } as never);
    await vi.waitFor(() => expect(runMachineLearning).toHaveBeenCalledOnce());
    expect(encodeImage).not.toHaveBeenCalled();

    releaseUpload();
    await expect(processing).resolves.toEqual({ encoded: true });
    expect(encodeImage).toHaveBeenCalledWith('/preview.webp');
  });
});

describe('Live Photo metadata', () => {
  it('keeps both source files visible while recording their shared identifier', async () => {
    const assetUpdate = vi.fn();
    const exifUpdate = vi.fn();
    const capturedAt = new Date('2026-08-17T00:00:00.000Z');
    const prisma = {
      asset: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'live-photo-video',
          type: 'IMAGE',
          originalPath: '/media/live-photo.heic',
          fileCreatedAt: capturedAt,
          duration: null,
          deletedAt: null,
        }),
        findFirst: vi.fn().mockResolvedValue({ id: 'live-photo-video' }),
        update: assetUpdate,
      },
      assetExif: { upsert: vi.fn(), update: exifUpdate },
      assetJobStatus: { upsert: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    const tags = {
      make: null,
      model: null,
      lensModel: null,
      width: 100,
      height: 100,
      orientation: null,
      dateTimeOriginal: capturedAt,
      modifyDate: null,
      timeZone: null,
      fNumber: null,
      focalLength: null,
      iso: null,
      exposureTime: null,
      latitude: null,
      longitude: null,
      description: '',
      rating: null,
      fps: null,
      bitsPerSample: null,
      colorspace: null,
      profileDescription: null,
      projectionType: null,
      durationSeconds: null,
      livePhotoCID: 'shared-live-photo-id',
    };
    const enqueue = vi.fn();
    const processor = new MetadataProcessor(
      prisma as never,
      { extract: vi.fn().mockResolvedValue(tags) } as never,
      {} as never,
      { enqueue } as never,
      { lookup: vi.fn() } as never,
      {} as never,
    );

    await processor.process(job(JOB.EXTRACT_METADATA));

    expect(exifUpdate).toHaveBeenCalledWith({
      where: { assetId: 'live-photo-video' },
      data: { autoStackId: 'shared-live-photo-id' },
    });
    expect(assetUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ visibility: expect.anything() }) }),
    );
    expect(enqueue).toHaveBeenCalledWith(QUEUE.THUMBNAIL, JOB.GENERATE_THUMBNAILS, {
      assetId: 'live-photo-video',
    });
  });
});
