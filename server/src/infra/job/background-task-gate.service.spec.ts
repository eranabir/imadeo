import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackgroundTaskGate } from './background-task-gate.service';

describe('BackgroundTaskGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const createGate = (idleMs = 10_000) =>
    new BackgroundTaskGate({ get: vi.fn().mockReturnValue(idleMs) } as never);

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
});
