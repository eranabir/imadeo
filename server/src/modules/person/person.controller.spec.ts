import { describe, expect, it, vi } from 'vitest';
import { AssetType, AssetVisibility } from '../../db';
import { PeopleAndPetsController } from './person.controller';

function createController() {
  const count = vi.fn().mockResolvedValue(0);
  const findMany = vi.fn().mockResolvedValue([]);
  const jobs = {
    getQueueStatistics: vi.fn().mockResolvedValue({ active: 0, waiting: 0, delayed: 0 }),
    releaseJobIds: vi.fn().mockResolvedValue(0),
    enqueueMany: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue(undefined),
  };
  const recognitionBatch = {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const ml = {
    videoRecognitionEnabled: false,
    faceRecognitionEnabled: true,
    isFaceRecognitionReady: vi.fn().mockResolvedValue(true),
    hasPets: vi.fn().mockResolvedValue(true),
  };
  const backgroundTasks = {
    getStatus: vi.fn().mockReturnValue({ activeQueues: {} }),
  };
  const controller = new PeopleAndPetsController(
    {} as never,
    {} as never,
    ml as never,
    jobs as never,
    {
      asset: { count, findMany },
      assetJobStatus: { updateMany: vi.fn() },
      recognitionBatch,
    } as never,
    {} as never,
    backgroundTasks as never,
  );
  return { controller, count, findMany, jobs, ml, recognitionBatch, backgroundTasks };
}

const expectedScope = {
  ownerId: 'owner-id',
  deletedAt: null,
  isDeviceOnly: false,
  visibility: { in: [AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE] },
  type: AssetType.IMAGE,
  previewPath: { not: null },
};

describe('PeopleAndPetsController discovery scope', () => {
  it('counts only media visible in the main library', async () => {
    const { controller, count } = createController();
    await controller.status('owner-id');
    expect(count).toHaveBeenNthCalledWith(1, { where: expectedScope });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining(expectedScope),
    });
  });

  it('reports progress for the active upload instead of the lifetime library', async () => {
    const { controller, count, ml, recognitionBatch, backgroundTasks } = createController();
    ml.videoRecognitionEnabled = true;
    backgroundTasks.getStatus.mockReturnValue({ activeQueues: { 'face-detection': 1 } });
    recognitionBatch.findFirst.mockResolvedValue({ id: 'new-upload' });
    count
      .mockResolvedValueOnce(4_428)
      .mockResolvedValueOnce(26)
      .mockResolvedValueOnce(36)
      .mockResolvedValueOnce(26);

    await expect(controller.status('owner-id')).resolves.toMatchObject({
      totalAssets: 4_428,
      pendingAssets: 26,
      scanTotalAssets: 36,
      scanPendingAssets: 26,
      processingAssets: 1,
      scanning: true,
    });
  });

  it('does not report recognition as running while video processing owns the server', async () => {
    const { controller, backgroundTasks } = createController();
    backgroundTasks.getStatus.mockReturnValue({ activeQueues: { 'video-transcode': 1 } });

    await expect(controller.status('owner-id')).resolves.toMatchObject({
      processingAssets: 0,
      scanning: false,
    });
  });

  it('reports recognition jobs that are queued behind media processing', async () => {
    const { controller, jobs } = createController();
    jobs.getQueueStatistics.mockResolvedValue({ active: 1, waiting: 24, delayed: 3 });

    await expect(controller.status('owner-id')).resolves.toMatchObject({
      queuedAssets: 28,
      processingAssets: 0,
      scanning: false,
    });
  });

  it('queues scans only for media visible in the main library', async () => {
    const { controller, findMany } = createController();
    await controller.scan('owner-id');
    expect(findMany).toHaveBeenCalledWith({
      where: expect.objectContaining(expectedScope),
      select: { id: true, type: true },
    });
  });

  it('rebuilds groups after queued detection finishes', async () => {
    const { controller, findMany, jobs } = createController();
    findMany.mockResolvedValue([{ id: 'photo-id', type: AssetType.IMAGE }]);

    await controller.scan('owner-id');

    expect(jobs.releaseJobIds).toHaveBeenLastCalledWith(
      'face-cluster',
      'cluster-faces',
      ['owner-id'],
    );
    expect(jobs.enqueue).toHaveBeenCalledWith('face-cluster', 'cluster-faces', {
      userId: 'owner-id',
    });
  });
});
