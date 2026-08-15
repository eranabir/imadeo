import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filesFromEntry,
  isMediaFile,
  MEDIA_EXTENSIONS,
  type DroppedEntry,
} from './uploadSelection';

function fileEntry(name: string, size: number): DroppedEntry {
  const file = new File([new Uint8Array(size)], name);
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (callback) => callback(file),
  };
}

function directoryEntry(name: string, batches: DroppedEntry[][]): DroppedEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let index = 0;
      return {
        readEntries: (callback) => callback(batches[index++] ?? []),
      };
    },
  };
}

describe('web upload selection', () => {
  it('stays aligned with every media extension accepted by the server', async () => {
    const source = await readFile(
      resolve(process.cwd(), '../server/src/modules/asset/asset.service.ts'),
      'utf8',
    );
    const start = source.indexOf('const IMAGE_EXTENSIONS');
    const end = source.indexOf('export interface UploadedFile', start);
    const serverExtensions = new Set(
      [...source.slice(start, end).matchAll(/'(\.[a-z0-9]+)'/g)].map((match) => match[1]),
    );

    expect(MEDIA_EXTENSIONS).toEqual(serverExtensions);
    for (const extension of serverExtensions) {
      expect(isMediaFile(new File(['media'], `capture${extension}`))).toBe(true);
    }
  });

  it('reads all 398 files from batched and nested directory entries', async () => {
    const entries = Array.from({ length: 398 }, (_, index) =>
      fileEntry(`photo-${index}.jpg`, index + 1),
    );
    const nested = directoryEntry('nested', [entries.slice(300), []]);
    const root = directoryEntry('backup', [
      entries.slice(0, 100),
      entries.slice(100, 200),
      entries.slice(200, 300),
      [nested],
      [],
    ]);

    const files = await filesFromEntry(root);

    expect(files).toHaveLength(398);
    expect(new Set(files.map(({ relativePath }) => relativePath)).size).toBe(398);
    expect(files.reduce((total, { file }) => total + file.size, 0)).toBe(
      entries.reduce((total, entry, index) => total + index + 1, 0),
    );
    expect(files.at(-1)?.relativePath).toBe('backup/nested/photo-397.jpg');
  });

  it('distinguishes supported media from sidecars without losing either count', async () => {
    const media = Array.from({ length: 299 }, (_, index) => fileEntry(`photo-${index}.jpg`, 10));
    const sidecars = Array.from({ length: 99 }, (_, index) => fileEntry(`photo-${index}.json`, 5));
    const files = await filesFromEntry(directoryEntry('export', [[...media, ...sidecars], []]));
    const supported = files.filter(({ file }) => isMediaFile(file));

    expect(files).toHaveLength(398);
    expect(supported).toHaveLength(299);
    expect(files.length - supported.length).toBe(99);
    expect(supported.reduce((total, { file }) => total + file.size, 0)).toBe(2_990);
  });
});
