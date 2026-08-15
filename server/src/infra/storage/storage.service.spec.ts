import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/configuration';
import { StorageService } from './storage.service';

describe('StorageService user isolation', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
  });

  const createStorage = async () => {
    const root = await mkdtemp(join(tmpdir(), 'imadeo-storage-'));
    temporaryRoots.push(root);
    const config = new ConfigService<AppConfig>({
      storage: {
        root,
        users: join(root, 'users'),
        backups: join(root, 'backups'),
        template: '{{y}}/{{filename}}',
        maxUploadBytes: 1024,
      },
      thumbnail: { format: 'webp' },
    } as AppConfig);
    return {
      root,
      storage: new StorageService(config as unknown as ConfigService<AppConfig, true>),
    };
  };

  it('puts every file type below the owning user directory', async () => {
    const { root, storage } = await createStorage();
    const ownerId = '9fd7c8cc-e6f4-4fd4-951d-d5267c3fb609';
    const userRoot = join(root, 'users', ownerId);

    expect(
      storage.buildOriginalPath({
        ownerId,
        assetId: 'asset-id',
        originalFileName: 'photo.jpg',
        localDateTime: new Date('2026-08-13T10:00:00Z'),
        isLocked: false,
      }),
    ).toBe(join(userRoot, 'library', '2026', 'photo.jpg'));
    expect(storage.buildDerivativePath('thumb', ownerId, 'abcdef')).toBe(
      join(userRoot, 'thumbs', 'ab', 'cd', 'abcdef-thumb.webp'),
    );
    expect(storage.buildIncomingPath(ownerId, 'upload.jpg')).toBe(
      join(userRoot, 'upload', 'upload.jpg'),
    );
    expect(storage.buildProfilePath(ownerId, '.jpeg')).toBe(
      join(userRoot, 'profile', 'avatar.jpeg'),
    );
  });

  it('creates a complete directory tree for each account', async () => {
    const { root, storage } = await createStorage();
    const ownerId = '21803455-b32f-4a48-a407-b4195ad5ec0f';

    await storage.ensureUserRoot(ownerId);

    await expect(storage.exists(join(root, 'users', ownerId, 'library'))).resolves.toBe(true);
    await expect(storage.exists(join(root, 'users', ownerId, 'thumbs'))).resolves.toBe(true);
    await expect(storage.exists(join(root, 'users', ownerId, 'locked'))).resolves.toBe(true);
  });

  it('never overwrites simultaneous uploads that resolve to the same path', async () => {
    const { root, storage } = await createStorage();
    const sourceA = join(root, 'upload-a.jpg');
    const sourceB = join(root, 'upload-b.jpg');
    const destination = join(root, 'users', 'owner-id', 'library', '2026', 'same-name.jpg');
    await Promise.all([
      writeFile(sourceA, Buffer.from('first-photo')),
      writeFile(sourceB, Buffer.from('second-photo')),
    ]);

    const paths = await Promise.all([
      storage.move(sourceA, destination),
      storage.move(sourceB, destination),
    ]);

    expect(new Set(paths).size).toBe(2);
    const contents = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
    expect(contents.sort()).toEqual(['first-photo', 'second-photo']);
  });
});
