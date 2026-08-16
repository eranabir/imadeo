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
  const controller = new PeopleAndPetsController(
    {} as never,
    {} as never,
    {
      videoRecognitionEnabled: false,
      faceRecognitionEnabled: true,
      isFaceRecognitionReady: vi.fn().mockResolvedValue(true),
      hasPets: vi.fn().mockResolvedValue(true),
    } as never,
    jobs as never,
    { asset: { count, findMany }, assetJobStatus: { updateMany: vi.fn() } } as never,
    {} as never,
  );
  return { controller, count, findMany, jobs };
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
