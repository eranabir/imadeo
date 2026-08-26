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

    await expect(service.cancelAssetProcessing(['waiting-id', 'active-id'])).resolves.toBe(8);
    expect(waitingRemove).toHaveBeenCalledTimes(8);
    expect(activeRemove).not.toHaveBeenCalled();
  });

  it('removes redundant queued jobs after owner-wide processing finishes', async () => {
    const waitingRemove = vi.fn().mockResolvedValue(undefined);
    const activeRemove = vi.fn().mockResolvedValue(undefined);
    const duplicateQueue = {
      getJob: vi.fn(async (id: string) => ({
        id,
        getState: vi.fn().mockResolvedValue(id.endsWith('--active-id') ? 'active' : 'waiting'),
        remove: id.endsWith('--active-id') ? activeRemove : waitingRemove,
      })),
    };
    const emptyQueue = {};
    const service = new JobService(
      emptyQueue as never,
      emptyQueue as never,
      emptyQueue as never,
      emptyQueue as never,
      emptyQueue as never,
      emptyQueue as never,
      duplicateQueue as never,
      emptyQueue as never,
      emptyQueue as never,
    );

    await expect(
      service.removeQueuedAssetJobs(
        QUEUE.DUPLICATE,
        JOB.DETECT_DUPLICATES,
        ['waiting-id', 'active-id'],
      ),
    ).resolves.toBe(1);
    expect(waitingRemove).toHaveBeenCalledOnce();
    expect(activeRemove).not.toHaveBeenCalled();
  });

  it('expands only active file jobs while keeping queue backlogs aggregated', async () => {
    const emptyQueue = () => ({
      getJobCounts: vi.fn().mockResolvedValue({ active: 0, waiting: 4, delayed: 0, failed: 0 }),
      isPaused: vi.fn().mockResolvedValue(false),
      getActive: vi.fn().mockResolvedValue([]),
    });
    const metadata = {
      getJobCounts: vi.fn().mockResolvedValue({ active: 1, waiting: 12, delayed: 0, failed: 0 }),
      isPaused: vi.fn().mockResolvedValue(false),
      getActive: vi.fn().mockResolvedValue([{
        id: 'job-id',
        name: JOB.EXTRACT_METADATA,
        data: { assetId: 'asset-id' },
        progress: 25,
        timestamp: Date.parse('2026-08-19T10:00:00Z'),
        processedOn: Date.parse('2026-08-19T10:00:01Z'),
        attemptsMade: 0,
      }]),
    };
    const service = new JobService(
      metadata as never,
      emptyQueue() as never,
      emptyQueue() as never,
      emptyQueue() as never,
      emptyQueue() as never,
      emptyQueue() as never,
      emptyQueue() as never,
      emptyQueue() as never,
      emptyQueue() as never,
    );

    const result = await service.getAssetProcessingSnapshot();

    expect(result.queues).toHaveLength(6);
    expect(result.queues[0]).toMatchObject({ name: QUEUE.METADATA, active: 1, waiting: 12 });
    expect(result.activeJobs).toEqual([expect.objectContaining({
      id: 'job-id',
      assetId: 'asset-id',
      queue: QUEUE.METADATA,
      name: JOB.EXTRACT_METADATA,
      progress: 25,
    })]);
  });

  it('keeps analysis waiting until every media queue is drained', async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({ active: 0, waiting: 0, delayed: 0 }),
      isPaused: vi.fn().mockResolvedValue(false),
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
    const statistics = vi.spyOn(service, 'getQueueStatistics');
    statistics
      .mockResolvedValueOnce({ active: 1, waiting: 0, delayed: 0 } as never)
      .mockResolvedValueOnce({ active: 0, waiting: 0, delayed: 0 } as never)
      .mockResolvedValueOnce({ active: 0, waiting: 0, delayed: 0 } as never)
      .mockResolvedValue({ active: 0, waiting: 0, delayed: 0 } as never);

    await service.waitForMediaProcessingIdle(0);

    expect(statistics).toHaveBeenCalledTimes(6);
  });
});
