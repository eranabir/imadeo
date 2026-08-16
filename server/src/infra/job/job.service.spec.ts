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
});
