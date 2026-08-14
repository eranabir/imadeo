import { describe, expect, it, vi } from 'vitest';
import { DuplicateService } from './duplicate.service';

describe('DuplicateService locations', () => {
  it('returns every user-visible location for each duplicate', async () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    const common = {
      duplicateId: 'duplicate-id',
      localDateTime: now,
      createdAt: now,
      type: 'IMAGE',
      checksum: new Uint8Array([1, 2, 3]),
      perceptualHash: null,
      exif: null,
    };
    const prisma = {
      asset: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...common,
            id: 'folder-copy',
            originalFileName: 'folder-copy.jpg',
            fileSizeInByte: 200n,
            isDeviceOnly: false,
            visibility: 'TIMELINE',
            folder: { id: 'child', name: 'Trips' },
            albums: [{ album: { name: 'Summer', folderId: 'root' } }],
            deviceAssets: [{ device: { name: 'Eran’s iPhone' } }],
          },
          {
            ...common,
            id: 'archive-copy',
            originalFileName: 'archive-copy.jpg',
            fileSizeInByte: 100n,
            isDeviceOnly: false,
            visibility: 'ARCHIVE',
            folder: null,
            albums: [],
            deviceAssets: [],
          },
        ]),
      },
      folder: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'root', name: 'Family', parentId: null },
          { id: 'child', name: 'Trips', parentId: 'root' },
        ]),
      },
    };
    const service = new DuplicateService(prisma as never, {} as never, {} as never);

    const [group] = await service.list('owner-id');

    expect(group.assets[0].locations).toEqual([
      { kind: 'folder', label: 'Browse / Family / Trips' },
      { kind: 'album', label: 'Browse / Family / Summer' },
      { kind: 'device', label: 'Devices / Eran’s iPhone Library' },
    ]);
    expect(group.assets[1].locations).toEqual([{ kind: 'archive', label: 'Archive' }]);
  });
});
