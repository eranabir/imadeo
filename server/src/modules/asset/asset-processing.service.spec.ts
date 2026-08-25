import { describe, expect, it, vi } from 'vitest';
import { JOB, QUEUE } from '../../infra/job/job.constants';
import { AssetProcessingService } from './asset-processing.service';

describe('AssetProcessingService', () => {
  it('cancels every queued stage and tombstones upload retries for trashed assets', async () => {
    const cancelUploadReceipts = vi.fn().mockResolvedValue(undefined);
    const cancelAssetProcessing = vi.fn().mockResolvedValue(7);
    const service = new AssetProcessingService(
      {
        asset: {
          findMany: vi.fn().mockResolvedValue([
            { uploadId: 'upload-a' },
            { uploadId: null },
            { uploadId: 'upload-b' },
          ]),
        },
      } as never,
      { cancelAssetProcessing } as never,
      { cancelUploadReceipts } as never,
      {} as never,
      {} as never,
    );

    await expect(service.stop('owner-id', ['asset-a', 'asset-a', 'asset-b'])).resolves.toEqual({
      removedJobs: 7,
    });
    expect(cancelUploadReceipts).toHaveBeenCalledWith('owner-id', ['upload-a', 'upload-b']);
    expect(cancelAssetProcessing).toHaveBeenCalledWith(['asset-a', 'asset-b']);
  });

  it('clears the retry tombstone and resumes only the first incomplete stage', async () => {
    const releaseJobIds = vi.fn().mockResolvedValue(0);
    const enqueueMany = vi.fn().mockResolvedValue(undefined);
    const clearCancelledUploadReceipts = vi.fn().mockResolvedValue(undefined);
    const service = new AssetProcessingService(
      {
        asset: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'asset-id',
              type: 'IMAGE',
              visibility: 'TIMELINE',
              uploadId: 'upload-id',
              jobStatus: { metadataExtractedAt: null },
            },
          ]),
        },
      } as never,
      { releaseJobIds, enqueueMany } as never,
      { clearCancelledUploadReceipts } as never,
      { get: vi.fn().mockReturnValue(false) } as never,
      { faceRecognitionEnabled: false } as never,
    );

    await expect(service.resume('owner-id', ['asset-id'])).resolves.toBe(1);
    expect(clearCancelledUploadReceipts).toHaveBeenCalledWith('owner-id', ['upload-id']);
    expect(releaseJobIds).toHaveBeenCalledWith(
      QUEUE.METADATA,
      JOB.EXTRACT_METADATA,
      ['asset-id'],
    );
    expect(enqueueMany).toHaveBeenCalledWith(
      QUEUE.METADATA,
      JOB.EXTRACT_METADATA,
      [{ assetId: 'asset-id' }],
    );
  });
});
