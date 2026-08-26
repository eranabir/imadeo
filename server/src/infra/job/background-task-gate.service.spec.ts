import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUE } from './job.constants';
import { BackgroundTaskGate } from './background-task-gate.service';

describe('BackgroundTaskGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const createGate = (
    idleMs = 10_000,
    userIdleMs = 15_000,
    processingConcurrency = 3,
    activeUserConcurrency = 0,
  ) =>
    new BackgroundTaskGate(
      {
        get: vi.fn((key: string) => {
          if (key === 'jobs.userIdleMs') return userIdleMs;
          if (key === 'jobs.processingConcurrency') return processingConcurrency;
          if (key === 'jobs.activeUserConcurrency') return activeUserConcurrency;
          return idleMs;
        }),
      } as never,
      {
        beginUpload: vi.fn(() => vi.fn()),
        noteUserActivity: vi.fn(),
        waitForBackgroundWindow: vi.fn().mockResolvedValue(undefined),
        backgroundWindowIsOpen: vi.fn().mockResolvedValue(true),
        activeUploadCount: vi.fn().mockResolvedValue(0),
        userIsActive: vi.fn().mockResolvedValue(false),
        publishWorkerStatus: vi.fn().mockResolvedValue(undefined),
        readWorkerStatus: vi.fn().mockResolvedValue(null),
      } as never,
    );

  it('holds background work until the upload idle grace period ends', async () => {
    const gate = createGate();
    const finish = gate.beginUpload();
    let resumed = false;
    const waiting = gate.runMachineLearning(async () => {
      resumed = true;
    });

    finish();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(resumed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(resumed).toBe(true);
  });

  it('keeps waiting across consecutive uploads and ignores duplicate completion', async () => {
    const gate = createGate(1_000);
    const finishFirst = gate.beginUpload();
    let resumed = false;
    const waiting = gate.runMachineLearning(async () => {
      resumed = true;
    });
    finishFirst();
    finishFirst();

    await vi.advanceTimersByTimeAsync(500);
    const finishSecond = gate.beginUpload();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resumed).toBe(false);

    finishSecond();
    await vi.advanceTimersByTimeAsync(1_000);
    await waiting;
    expect(resumed).toBe(true);
  });

  it('does not start thumbnail processing while an upload is active', async () => {
    const gate = createGate(1_000);
    const finishUpload = gate.beginUpload();
    let started = false;
    const thumbnail = gate.runThumbnail(async () => {
      started = true;
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toBe(false);

    finishUpload();
    await vi.advanceTimersByTimeAsync(999);
    expect(started).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await thumbnail;
    expect(started).toBe(true);
  });

  it('holds media and heavy processing until the app becomes idle', async () => {
    const gate = createGate(0, 2_000);
    gate.noteUserActivity();
    const events: string[] = [];
    const media = gate.runMediaProcessing(async () => events.push('media'));
    const heavy = gate.runHeavyProcessing(async () => events.push('heavy'));

    expect(events).toEqual([]);
    expect(gate.getStatus()).toMatchObject({
      mode: 'interactive',
      media: { active: 0, waiting: 1, limit: 0 },
      heavy: { active: 0 },
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(events).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([media, heavy]);
    expect(events).toEqual(['media', 'heavy']);
  });

  it('finishes active ML, runs waiting thumbnails first, and never overlaps them', async () => {
    const gate = createGate(0);
    const events: string[] = [];
    let finishMachineLearning: () => void = () => undefined;
    let finishThumbnail: () => void = () => undefined;
    const machineLearningHold = new Promise<void>((resolve) => {
      finishMachineLearning = resolve;
    });
    const thumbnailHold = new Promise<void>((resolve) => {
      finishThumbnail = resolve;
    });

    const firstMachineLearning = gate.runMachineLearning(async () => {
      events.push('ml-1-start');
      await machineLearningHold;
      events.push('ml-1-end');
    });
    await vi.advanceTimersByTimeAsync(0);
    const thumbnail = gate.runThumbnail(async () => {
      events.push('thumbnail-start');
      await thumbnailHold;
      events.push('thumbnail-end');
    });
    const secondMachineLearning = gate.runMachineLearning(async () => {
      events.push('ml-2-start');
    });

    expect(events).toEqual(['ml-1-start']);
    finishMachineLearning();
    await firstMachineLearning;
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['ml-1-start', 'ml-1-end', 'thumbnail-start']);

    finishThumbnail();
    await Promise.all([thumbnail, secondMachineLearning]);
    expect(events).toEqual([
      'ml-1-start',
      'ml-1-end',
      'thumbnail-start',
      'thumbnail-end',
      'ml-2-start',
    ]);
  });

  it('reports only work that has entered a scheduler lane as active', async () => {
    const gate = createGate(0);
    let finish: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const processing = gate.runMachineLearning(async () => hold, 'face-detection');
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.getStatus().activeQueues).toEqual({ 'face-detection': 1 });

    finish();
    await processing;
    expect(gate.getStatus().activeQueues).toEqual({});
  });

  it('runs face recognition before queued search and duplicate work', async () => {
    const gate = createGate(0);
    const events: string[] = [];
    let finishVideo: () => void = () => undefined;
    const videoHold = new Promise<void>((resolve) => {
      finishVideo = resolve;
    });

    const video = gate.runHeavyProcessing(async () => {
      events.push('video');
      await videoHold;
    }, QUEUE.VIDEO);
    await vi.advanceTimersByTimeAsync(0);
    const duplicate = gate.runHeavyProcessing(async () => {
      events.push('duplicate');
    }, QUEUE.DUPLICATE);
    const search = gate.runHeavyProcessing(async () => {
      events.push('search');
    }, QUEUE.SMART_SEARCH);
    const recognition = gate.runMachineLearning(async () => {
      events.push('recognition');
    }, QUEUE.FACE_DETECTION);
    await vi.advanceTimersByTimeAsync(0);

    finishVideo();
    await Promise.all([video, duplicate, search, recognition]);
    expect(events).toEqual(['video', 'recognition', 'search', 'duplicate']);
  });
});
