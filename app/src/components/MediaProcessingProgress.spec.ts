import { describe, expect, it } from 'vitest';
import { mediaProcessingState, type ProcessingSchedulerStatus } from './MediaProcessingProgress';

const scheduler = (
  overrides: Partial<ProcessingSchedulerStatus> = {},
): ProcessingSchedulerStatus => ({
  workerOnline: true,
  mode: 'idle',
  activeUploads: 0,
  media: { active: 0, waiting: 10, limit: 3 },
  heavy: { active: 0 },
  ...overrides,
});

describe('mediaProcessingState', () => {
  it('explains when queued files have no processing worker', () => {
    expect(mediaProcessingState(scheduler({ workerOnline: false }))).toMatchObject({
      title: 'Processing worker is offline',
      icon: 'waiting',
    });
  });

  it('does not claim queued files are processing during an upload', () => {
    expect(mediaProcessingState(scheduler({ mode: 'uploading', activeUploads: 2 }))).toMatchObject({
      title: 'Waiting for uploads to finish',
      icon: 'upload',
    });
  });

  it('waits while the app is active and no background slots are allowed', () => {
    expect(
      mediaProcessingState(
        scheduler({ mode: 'interactive', media: { active: 0, waiting: 10, limit: 0 } }),
      ),
    ).toMatchObject({ title: 'Waiting until Imadeo is idle', icon: 'waiting' });
  });

  it('shows preparation only when a processing lane is active', () => {
    expect(
      mediaProcessingState(scheduler({ media: { active: 1, waiting: 9, limit: 3 } })),
    ).toMatchObject({ title: 'Preparing media', icon: 'processing' });
  });
});
