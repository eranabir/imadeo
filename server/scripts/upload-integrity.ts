import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execute = promisify(execFile);
const baseUrl = process.env.UPLOAD_TEST_BASE_URL ?? 'http://127.0.0.1:6677/api';
const mediaRoot = process.env.UPLOAD_TEST_MEDIA_ROOT;
const fixedDate = '2024-02-03T04:05:06.000Z';
const concurrency = 4;

interface CorpusFile {
  name: string;
  relativePath: string;
  mime: string;
  bytes: Buffer;
  hash: string;
}

interface Uploaded extends CorpusFile {
  id: string;
  storedPath?: string;
}

const sha1 = (bytes: Buffer | Uint8Array) => createHash('sha1').update(bytes).digest('hex');

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function buildCorpus(): Promise<CorpusFile[]> {
  const files: CorpusFile[] = [];
  const add = (name: string, relativePath: string, mime: string, bytes: Buffer) => {
    files.push({ name, relativePath, mime, bytes, hash: sha1(bytes) });
  };

  for (let index = 0; index < 380; index++) {
    const pixels = Buffer.alloc(32 * 32 * 3);
    for (let offset = 0; offset < pixels.length; offset++) {
      pixels[offset] = (offset * 31 + index * 17 + Math.floor(index / 7) * 13) % 256;
    }
    pixels.writeUInt16LE(index, 0);
    const bytes = await sharp(pixels, { raw: { width: 32, height: 32, channels: 3 } })
      .png({ compressionLevel: index % 10 })
      .toBuffer();
    const path = `upload-integrity/batch-${Math.floor(index / 23)}/group-${index % 23}/same-name.png`;
    add('same-name.png', path, 'image/png', bytes);
  }

  for (let index = 0; index < 10; index++) {
    const bytes = await sharp({
      create: {
        width: 320 + index,
        height: 240,
        channels: 3,
        background: { r: index * 23, g: 255 - index * 17, b: index * 11 },
      },
    }).jpeg({ quality: 90 }).toBuffer();
    add('same-name.jpg', `upload-integrity/jpeg-${index}/same-name.jpg`, 'image/jpeg', bytes);
  }

  for (let index = 0; index < 5; index++) {
    const bytes = await sharp({
      create: {
        width: 180,
        height: 120 + index,
        channels: 4,
        background: { r: index * 40, g: index * 21, b: 240 - index * 20, alpha: 1 },
      },
    }).webp({ quality: 85 }).toBuffer();
    add(`photo-${index}.webp`, `upload-integrity/webp/photo-${index}.webp`, 'image/webp', bytes);
  }

  const avif = await sharp({
    create: { width: 200, height: 150, channels: 3, background: { r: 20, g: 130, b: 210 } },
  }).avif({ quality: 70 }).toBuffer();
  add('photo.avif', 'upload-integrity/modern/photo.avif', 'image/avif', avif);

  const work = await mkdtemp(join(tmpdir(), 'imadeo-upload-corpus-'));
  const videoPath = join(work, 'clip.mp4');
  await execute('ffmpeg', [
    '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath,
  ]);
  add('clip.mp4', 'upload-integrity/video/clip.mp4', 'video/mp4', await readFile(videoPath));

  const largePixels = randomBytes(4096 * 4096 * 3);
  const large = await sharp(largePixels, { raw: { width: 4096, height: 4096, channels: 3 } })
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .toBuffer();
  add('same-name.jpg', 'upload-integrity/large/same-name.jpg', 'image/jpeg', large);

  if (files.length !== 398) throw new Error(`Corpus count is ${files.length}, expected 398`);
  if (new Set(files.map(({ hash }) => hash)).size !== files.length) {
    throw new Error('Corpus contains duplicate bytes; integrity expectations would be ambiguous');
  }
  if (Math.min(...files.map(({ bytes }) => bytes.length)) >= 1_024) {
    throw new Error('Corpus is missing a sub-kilobyte media file');
  }
  if (large.length < 10 * 1024 * 1024) {
    throw new Error(`Large-file fixture is only ${large.length} bytes`);
  }
  return files;
}

async function uploadFile(file: CorpusFile, token: string, allowDuplicate = false) {
  const form = new FormData();
  form.append('assetData', new File([file.bytes], file.name, { type: file.mime }));
  form.append('fileCreatedAt', fixedDate);
  form.append('fileModifiedAt', fixedDate);
  form.append('relativePath', file.relativePath);
  if (allowDuplicate) form.append('allowDuplicate', 'true');

  return jsonRequest<{ id: string; status: 'created' | 'duplicate' | 'organized' | 'restored' }>(
    '/assets/upload',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
  );
}

async function runQueue<T>(items: readonly T[], work: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const errors: Error[] = [];
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await work(items[index], index);
      } catch (error) {
        errors.push(error as Error);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (errors.length > 0) {
    throw new Error(`${errors.length} queued operations failed\n${errors.slice(0, 5).join('\n')}`);
  }
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return nested.flat();
}

async function main() {
  const corpus = await buildCorpus();
  const sourceBytes = corpus.reduce((total, file) => total + file.bytes.length, 0);
  const session = await jsonRequest<{ accessToken: string; user: { id: string } }>('/auth/sign-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Imadeo-Client': 'native' },
    body: JSON.stringify({
      email: 'upload-integrity@imadeo.test',
      password: 'Upload-integrity-2026!',
      name: 'Upload Integrity',
    }),
  });

  const uploaded: Uploaded[] = [];
  await runQueue(corpus, async (file) => {
    const result = await uploadFile(file, session.accessToken);
    if (result.status !== 'created') throw new Error(`${file.relativePath}: ${result.status}`);
    uploaded.push({ ...file, id: result.id });
  });
  if (uploaded.length !== corpus.length) {
    throw new Error(`Uploaded ${uploaded.length} of ${corpus.length} files`);
  }

  const auth = { Authorization: `Bearer ${session.accessToken}` };
  const listing = await jsonRequest<{
    items: Array<{ id: string; fileSizeInByte: string }>;
    pagination: { total: number };
  }>('/assets?size=1000', { headers: auth });
  if (listing.pagination.total !== 398 || listing.items.length !== 398) {
    throw new Error(`API lists ${listing.items.length}/${listing.pagination.total}, expected 398`);
  }

  let downloadedBytes = 0;
  await runQueue(uploaded, async (file) => {
    const detail = await jsonRequest<{
      fileSizeInByte: string;
      originalFileName: string;
      originalPath: string;
      folder: { id: string } | null;
    }>(`/assets/${file.id}`, { headers: auth });
    if (Number(detail.fileSizeInByte) !== file.bytes.length) {
      throw new Error(`${file.relativePath}: database size ${detail.fileSizeInByte}, source ${file.bytes.length}`);
    }
    if (detail.originalFileName !== basename(file.relativePath)) {
      throw new Error(`${file.relativePath}: stored name ${detail.originalFileName}`);
    }
    if (!detail.folder) throw new Error(`${file.relativePath}: destination folder is missing`);
    const breadcrumbs = await jsonRequest<Array<{ name: string }>>(
      `/folders/${detail.folder.id}/breadcrumbs`,
      { headers: auth },
    );
    const expectedFolders = file.relativePath.split('/').slice(0, -1);
    if (breadcrumbs.map(({ name }) => name).join('/') !== expectedFolders.join('/')) {
      throw new Error(`${file.relativePath}: folder hierarchy was not preserved`);
    }
    file.storedPath = detail.originalPath;

    const response = await fetch(`${baseUrl}/assets/${file.id}/original`, { headers: auth });
    if (!response.ok) throw new Error(`${file.relativePath}: download returned ${response.status}`);
    if (Number(response.headers.get('content-length')) !== file.bytes.length) {
      throw new Error(`${file.relativePath}: Content-Length does not match source`);
    }
    const downloaded = Buffer.from(await response.arrayBuffer());
    downloadedBytes += downloaded.length;
    if (downloaded.length !== file.bytes.length || sha1(downloaded) !== file.hash) {
      throw new Error(`${file.relativePath}: downloaded bytes differ from source`);
    }
  });
  if (downloadedBytes !== sourceBytes) {
    throw new Error(`Downloaded ${downloadedBytes} bytes, expected ${sourceBytes}`);
  }

  const raceBytes = Buffer.concat([corpus[0].bytes, Buffer.from('concurrent-deduplication')]);
  const raceBase: CorpusFile = {
    name: 'race.png',
    relativePath: 'upload-integrity/race/race.png',
    mime: 'image/png',
    bytes: raceBytes,
    hash: sha1(raceBytes),
  };
  const raceResults = await Promise.all(
    Array.from({ length: 4 }, () => uploadFile(raceBase, session.accessToken)),
  );
  const raceCreated = raceResults.filter(({ status }) => status === 'created');
  const raceDuplicates = raceResults.filter(({ status }) => status === 'duplicate');
  if (raceCreated.length !== 1 || raceDuplicates.length !== 3) {
    throw new Error(
      `Concurrent duplicate upload created ${raceCreated.length} assets and rejected ${raceDuplicates.length}`,
    );
  }
  const raceDownload = await fetch(`${baseUrl}/assets/${raceCreated[0].id}/original`, { headers: auth });
  const raceDownloaded = Buffer.from(await raceDownload.arrayBuffer());
  if (!raceDownload.ok || sha1(raceDownloaded) !== raceBase.hash) {
    throw new Error('Concurrent duplicate winner does not match the source bytes');
  }

  const locationCopies = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      uploadFile(
        { ...raceBase, relativePath: `upload-integrity/copy-${index}/race.png` },
        session.accessToken,
      ),
    ),
  );
  if (locationCopies.some(({ status }) => status !== 'created')) {
    throw new Error(`Same bytes in separate folders were not all preserved: ${locationCopies.map(({ status }) => status)}`);
  }

  const duplicate = await uploadFile(corpus[0], session.accessToken);
  if (duplicate.status !== 'duplicate') throw new Error(`Duplicate returned ${duplicate.status}`);
  const allowed = await uploadFile(corpus[0], session.accessToken, true);
  if (allowed.status !== 'created') throw new Error(`Allowed duplicate returned ${allowed.status}`);

  const retryBytes = await sharp({
    create: { width: 96, height: 64, channels: 3, background: { r: 12, g: 220, b: 90 } },
  }).png().toBuffer();
  const retryFile: CorpusFile = {
    name: 'retry.png',
    relativePath: 'upload-integrity/retry/retry.png',
    mime: 'image/png',
    bytes: retryBytes,
    hash: sha1(retryBytes),
  };
  if (!uploaded[0].storedPath) throw new Error('Stored path was not returned for failure testing');
  const storageYear = dirname(uploaded[0].storedPath);
  const originalMode = (await stat(storageYear)).mode & 0o777;
  let forcedFailure = false;
  await chmod(storageYear, 0o500);
  try {
    await uploadFile(retryFile, session.accessToken);
  } catch {
    forcedFailure = true;
  } finally {
    await chmod(storageYear, originalMode);
  }
  if (!forcedFailure) throw new Error('Read-only storage did not reject the upload');
  const retried = await uploadFile(retryFile, session.accessToken);
  if (retried.status !== 'created') throw new Error(`Retry returned ${retried.status}`);
  const retryDownload = await fetch(`${baseUrl}/assets/${retried.id}/original`, { headers: auth });
  if (!retryDownload.ok || sha1(Buffer.from(await retryDownload.arrayBuffer())) !== retryFile.hash) {
    throw new Error('Retried upload does not match the source bytes');
  }

  const oversizedBytes = Buffer.alloc((50 * 1024 * 1024) + 1, 0x5a);
  const oversizedForm = new FormData();
  oversizedForm.append('assetData', new File([oversizedBytes], 'too-large.jpg', { type: 'image/jpeg' }));
  oversizedForm.append('fileCreatedAt', fixedDate);
  const oversizedResponse = await fetch(`${baseUrl}/assets/upload`, {
    method: 'POST',
    headers: auth,
    body: oversizedForm,
  });
  if (oversizedResponse.ok) throw new Error('Upload larger than MAX_UPLOAD_BYTES was accepted');

  const afterDuplicates = await jsonRequest<{ pagination: { total: number } }>('/assets?size=1', {
    headers: auth,
  });
  if (afterDuplicates.pagination.total !== 405) {
    throw new Error(`Upload handling left ${afterDuplicates.pagination.total} assets, expected 405`);
  }

  const video = uploaded.find(({ mime }) => mime === 'video/mp4');
  if (!video) throw new Error('Video fixture was not uploaded');
  const range = await fetch(`${baseUrl}/assets/${video.id}/original`, {
    headers: { ...auth, Range: 'bytes=0-1023' },
  });
  if (range.status !== 206 || (await range.arrayBuffer()).byteLength !== 1_024) {
    throw new Error(`Video range response was ${range.status}`);
  }

  if (mediaRoot) {
    const library = join(mediaRoot, 'users', session.user.id, 'library');
    const diskFiles = await filesBelow(library);
    if (diskFiles.length !== 405 || new Set(diskFiles).size !== 405) {
      throw new Error(`Storage contains ${diskFiles.length} originals, expected 405 unique paths`);
    }
    const diskBytes = await Promise.all(diskFiles.map(async (path) => (await stat(path)).size));
    const expectedDiskBytes = sourceBytes + (raceBytes.length * 5) + corpus[0].bytes.length + retryBytes.length;
    if (diskBytes.reduce((total, size) => total + size, 0) !== expectedDiskBytes) {
      throw new Error('Storage byte total does not match the accepted uploads');
    }
    const incoming = await filesBelow(join(mediaRoot, 'users', session.user.id, 'upload'));
    if (incoming.length !== 0) throw new Error(`${incoming.length} temporary uploads were left behind`);
  }

  process.stdout.write(JSON.stringify({
    filesSelected: corpus.length,
    filesCreated: uploaded.length,
    sourceBytes,
    downloadedBytes,
    smallestFileBytes: Math.min(...corpus.map(({ bytes }) => bytes.length)),
    largestFileBytes: Math.max(...corpus.map(({ bytes }) => bytes.length)),
    exactHashMatches: uploaded.length,
    concurrentDuplicateCreated: raceCreated.length,
    concurrentDuplicatesRejected: raceDuplicates.length,
    sameBytesInDifferentFoldersPreserved: locationCopies.length,
    duplicateRejected: true,
    deliberateDuplicateCreated: true,
    forcedFailureRetried: true,
    oversizedUploadRejected: true,
    videoRangeVerified: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
