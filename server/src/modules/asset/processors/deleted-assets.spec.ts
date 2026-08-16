import { describe, expect, it, vi } from 'vitest';
import { JOB } from '../../../infra/job/job.constants';
import { FaceDetectionProcessor } from '../../person/face.processor';
import { ClipProcessor } from './clip.processor';
import { DuplicateProcessor } from './duplicate.processor';
import { MetadataProcessor } from './metadata.processor';
import { ThumbnailProcessor } from './thumbnail.processor';
import { VideoProcessor } from './video.processor';

const job = (name: string) => ({ name, data: { assetId: 'deleted-id' } }) as never;
const deletedImage = { id: 'deleted-id', type: 'IMAGE', deletedAt: new Date() };

describe('deleted asset processing', () => {
  it('skips every queued image-processing stage before reading the file', async () => {
    const prisma = { asset: { findUnique: vi.fn().mockResolvedValue(deletedImage) } };
    const extract = vi.fn();
    const thumbnails = vi.fn();
    const encodeImage = vi.fn();
    const detectDuplicates = vi.fn();
    const detectFaces = vi.fn();

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
    );
    const clip = new ClipProcessor(prisma as never, { encodeImage } as never);
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
    );

    await expect(processor.process(job(JOB.TRANSCODE_VIDEO))).resolves.toEqual({
      skipped: 'asset deleted',
    });
    expect(probeVideo).not.toHaveBeenCalled();
  });
});
