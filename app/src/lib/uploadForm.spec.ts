import { describe, expect, it } from 'vitest';
import { buildUploadForm } from './uploadForm';

describe('buildUploadForm', () => {
  it('retries into the saved folder and relative path', () => {
    const file = new File(['photo'], 'photo.jpg', {
      type: 'image/jpeg',
      lastModified: Date.parse('2026-08-15T12:00:00.000Z'),
    });
    const form = buildUploadForm(
      {
        file,
        relativePath: 'Trip/Day 1/photo.jpg',
        uploadId: 'stable-upload-receipt',
      },
      {
        folderId: 'existing-folder-id',
        label: 'Folder · Existing',
        path: '/browse/folders/existing-folder-id',
      },
    );

    expect(form.get('folderId')).toBe('existing-folder-id');
    expect(form.get('relativePath')).toBe('Trip/Day 1/photo.jpg');
    expect(form.get('uploadId')).toBe('stable-upload-receipt');
  });
});
