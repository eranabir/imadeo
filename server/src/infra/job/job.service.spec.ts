import { describe, expect, it, vi } from 'vitest';
import { JOB, QUEUE } from './job.constants';
import { JobService } from './job.service';

describe('JobService', () => {
  it('deduplicates owner-wide jobs by user id', async () => {
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const service = new JobService(
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
    );

    await service.enqueue(QUEUE.FACE_CLUSTER, JOB.CLUSTER_FACES, { userId: 'owner-id' });

    expect(queue.add).toHaveBeenCalledWith(
      JOB.CLUSTER_FACES,
      { userId: 'owner-id' },
      expect.objectContaining({ jobId: 'cluster-faces--owner-id' }),
    );
  });

  it('cancels waiting asset processing while leaving active work to its deletion guard', async () => {
    const waitingRemove = vi.fn().mockResolvedValue(undefined);
    const activeRemove = vi.fn().mockResolvedValue(undefined);
    const queue = {
      getJob: vi.fn(async (id: string) => {
        if (id.endsWith('--waiting-id')) {
          return { id, getState: vi.fn().mockResolvedValue('waiting'), remove: waitingRemove };
        }
        if (id.endsWith('--active-id')) {
          return { id, getState: vi.fn().mockResolvedValue('active'), remove: activeRemove };
        }
        return undefined;
      }),
    };
    const service = new JobService(
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
      queue as never,
    );

    await expect(service.cancelAssetProcessing(['waiting-id', 'active-id'])).resolves.toBe(7);
    expect(waitingRemove).toHaveBeenCalledTimes(7);
    expect(activeRemove).not.toHaveBeenCalled();
  });
});
