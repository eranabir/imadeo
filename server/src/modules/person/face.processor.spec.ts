import { describe, expect, it } from 'vitest';
import { repeatedVideoDetectionIds, videoRecognitionTimestamps } from './face.processor';

describe('videoRecognitionTimestamps', () => {
  it('samples ordinary videos near the start and at the configured interval', () => {
    expect(videoRecognitionTimestamps(31, 10, 60)).toEqual([1, 10, 20, 30]);
  });

  it('uses the first available frame for very short or unknown videos', () => {
    expect(videoRecognitionTimestamps(0.5, 10, 60)).toEqual([0.4]);
    expect(videoRecognitionTimestamps(0, 10, 60)).toEqual([0]);
  });

  it('caps long videos while retaining samples across the full duration', () => {
    const samples = videoRecognitionTimestamps(3_600, 10, 60);
    expect(samples).toHaveLength(60);
    expect(samples[0]).toBe(1);
    expect(samples.at(-1)).toBe(3_599.9);
  });
});

describe('repeatedVideoDetectionIds', () => {
  it('keeps the best ordered detection for each subject and removes later frames', () => {
    expect(
      repeatedVideoDetectionIds([
        { id: 'best-a', personId: 'a' },
        { id: 'best-b', personId: 'b' },
        { id: 'later-a', personId: 'a' },
        { id: 'unassigned', personId: null },
        { id: 'later-b', personId: 'b' },
      ]),
    ).toEqual(['later-a', 'later-b']);
  });
});
