import { describe, expect, it } from 'vitest';
import {
  isUsableVideoFace,
  redundantVideoDetectionIds,
  videoRecognitionTimestamps,
} from './face.processor';
import { SubjectKind } from '../../db';

describe('videoRecognitionTimestamps', () => {
  it('samples ordinary videos near the start and at the configured interval', () => {
    expect(videoRecognitionTimestamps(91, 30, 20)).toEqual([1, 30, 60, 90]);
  });

  it('uses the first available frame for very short or unknown videos', () => {
    expect(videoRecognitionTimestamps(0.5, 30, 20)).toEqual([0.4]);
    expect(videoRecognitionTimestamps(0, 30, 20)).toEqual([0]);
  });

  it('keeps the final sample away from an undecodable container tail', () => {
    expect(videoRecognitionTimestamps(25.92, 30, 20)).toEqual([1, 24.92]);
  });

  it('caps long videos while retaining samples across the full duration', () => {
    const samples = videoRecognitionTimestamps(3_600, 30, 20);
    expect(samples).toHaveLength(20);
    expect(samples[0]).toBe(1);
    expect(samples.at(-1)).toBe(3_599);
  });
});

describe('isUsableVideoFace', () => {
  const face = (
    boundingBox: { x1: number; y1: number; x2: number; y2: number },
    score = 0.9,
  ) => ({ boundingBox, score });
  const quality = { minScore: 0.85, minSharpness: 0.35 };

  it('accepts a clear, confident face fully inside the frame', () => {
    expect(
      isUsableVideoFace(
        face({ x1: 200, y1: 100, x2: 320, y2: 240 }),
        1280,
        720,
        0.5,
        quality,
      ),
    ).toBe(true);
  });

  it('rejects low-confidence, blurry, clipped and tiny detections', () => {
    const boxes = {
      good: { x1: 200, y1: 100, x2: 320, y2: 240 },
      clipped: { x1: 200, y1: 1, x2: 320, y2: 140 },
      tiny: { x1: 200, y1: 100, x2: 220, y2: 120 },
    };
    expect(isUsableVideoFace(face(boxes.good, 0.8), 1280, 720, 0.5, quality)).toBe(false);
    expect(isUsableVideoFace(face(boxes.good), 1280, 720, 0.2, quality)).toBe(false);
    expect(isUsableVideoFace(face(boxes.clipped), 1280, 720, 0.5, quality)).toBe(false);
    expect(isUsableVideoFace(face(boxes.tiny), 1280, 720, 0.5, quality)).toBe(false);
  });
});

describe('redundantVideoDetectionIds', () => {
  const detection = (
    id: string,
    personId: string | null,
    sourceTimecodeMs: number,
    kind: SubjectKind = SubjectKind.PERSON,
  ) => ({ id, personId, sourceTimecodeMs, kind });

  it('keeps the best crop for repeated subjects and removes later frames', () => {
    expect(
      redundantVideoDetectionIds([
        detection('best-a', 'a', 1_000),
        detection('best-b', 'b', 1_000),
        detection('later-a', 'a', 30_000),
        detection('unassigned', null, 30_000),
        detection('later-b', 'b', 30_000),
      ]),
    ).toEqual(['later-a', 'later-b']);
  });

  it('removes one-off people from multi-frame videos but retains pets', () => {
    expect(
      redundantVideoDetectionIds(
        [
          detection('person-once', 'a', 1_000),
          detection('pet-once', 'pet', 1_000, SubjectKind.PET),
        ],
        2,
      ),
    ).toEqual(['person-once']);
  });
});
