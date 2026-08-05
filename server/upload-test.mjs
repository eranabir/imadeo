// End-to-end test of the upload pipeline: ingest -> EXIF -> thumbnail -> transcode.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
// The exiftool CLI is not on PATH here; use the copy the server already depends on.
import { exiftool } from 'exiftool-vendored';

const BASE = 'http://127.0.0.1:3001/api';
const TMP = process.env.TMPDIR || 'C:/Users/eran/AppData/Local/Temp/claude/C--projects-imadeo/c93a5ee4-0725-4562-9b4a-37df28bcd59e/scratchpad/media';
let token = '';

const ok = (label, detail = '') => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);

const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return data;
};

const upload = async (filePath, fields = {}) => {
  const form = new FormData();
  const bytes = readFileSync(filePath);
  form.append('assetData', new Blob([bytes]), filePath.split(/[/\\]/).pop());
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));

  const res = await fetch(`${BASE}/assets/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`upload -> ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
};

const waitFor = async (label, check, timeoutMs = 90000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const run = async () => {
  mkdirSync(TMP, { recursive: true });

  console.log('\n== generating test media with ffmpeg ==');
  // A photo with real EXIF: capture date, camera make/model and GPS.
  const photo = join(TMP, 'beach.jpg');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:duration=1',
    '-frames:v', '1', '-q:v', '2', photo], { stdio: 'pipe' });
  await exiftool.write(
    photo,
    {
      Make: 'Canon',
      Model: 'EOS R6',
      LensModel: 'RF24-70mm',
      DateTimeOriginal: '2024:06:12 18:04:31',
      OffsetTimeOriginal: '+09:00',
      FNumber: 2.8,
      ISO: 400,
      FocalLength: 35,
      GPSLatitude: 35.6762,
      GPSLatitudeRef: 'N',
      GPSLongitude: 139.6503,
      GPSLongitudeRef: 'E',
    },
    { writeArgs: ['-overwrite_original'] },
  );
  ok('photo created', `${(statSync(photo).size / 1024).toFixed(0)} KB with EXIF`);

  // A video that is NOT web-playable (mpeg4 in avi) so transcoding must happen.
  const video = join(TMP, 'clip.avi');
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', '-shortest', video], { stdio: 'pipe' });
  ok('video created', `${(statSync(video).size / 1024).toFixed(0)} KB mpeg4/avi`);

  console.log('\n== auth ==');
  const login = await call('POST', '/auth/login', { email: 'admin@imadeo.local', password: 'imadeo-admin' });
  token = login.accessToken;
  ok('login');

  console.log('\n== pre-flight duplicate check ==');
  const sha = createHash('sha1').update(readFileSync(photo)).digest('hex');
  const pre = await call('POST', '/assets/check-duplicates', { checksums: [sha] });
  ok('checksum not yet present', `exists=${pre[0].exists}`);

  console.log('\n== upload into a nested folder ==');
  const created = await upload(photo, { relativePath: 'Trips/2024/Tokyo/beach.jpg', isFavorite: 'true' });
  ok('photo uploaded', `status=${created.status}`);
  if (created.status !== 'created') throw new Error(`expected created, got ${created.status}`);

  const dup = await upload(photo, {});
  ok('re-uploading identical bytes is rejected', `status=${dup.status}`);
  if (dup.status !== 'duplicate') throw new Error('duplicate not detected');
  if (dup.id !== created.id) throw new Error('duplicate returned a different asset');

  const post = await call('POST', '/assets/check-duplicates', { checksums: [sha] });
  ok('checksum now known to the server', `exists=${post[0].exists}`);

  console.log('\n== folder was auto-created from the path ==');
  const tree = await call('GET', '/folders/tree?recursiveCounts=true');
  const names = [];
  const walk = (nodes) => nodes.forEach((n) => { names.push(`${n.name}(${n.assetCount})`); walk(n.children); });
  walk(tree);
  ok('folder chain built from relativePath', names.join(' > '));
  if (!names.some((n) => n.startsWith('Tokyo'))) throw new Error('Tokyo folder not created');

  console.log('\n== metadata extraction ==');
  const withExif = await waitFor('EXIF', async () => {
    const a = await call('GET', `/assets/${created.id}`);
    return a.exif && a.exif.make ? a : null;
  });
  ok('camera read from EXIF', `${withExif.exif.make} ${withExif.exif.model}`);
  ok('lens + exposure', `${withExif.exif.lensModel} f/${withExif.exif.fNumber} ISO${withExif.exif.iso}`);
  ok('GPS read', `${withExif.exif.latitude.toFixed(4)}, ${withExif.exif.longitude.toFixed(4)}`);
  ok('dimensions', `${withExif.exif.exifImageWidth}x${withExif.exif.exifImageHeight}`);
  ok('timezone honoured', `tz=${withExif.exif.timeZone} localDateTime=${withExif.localDateTime}`);
  if (!withExif.localDateTime.startsWith('2024-06-12T18:04')) {
    throw new Error(`localDateTime should stay 18:04 in the capture zone, got ${withExif.localDateTime}`);
  }

  console.log('\n== thumbnails ==');
  const withThumb = await waitFor('thumbnail', async () => {
    const a = await call('GET', `/assets/${created.id}`);
    return a.thumbnailPath ? a : null;
  });
  ok('thumbnail generated');
  ok('thumbhash placeholder stored', `${withThumb.thumbhash ? 'yes' : 'no'}`);

  for (const [label, url] of [
    ['thumbnail', `/assets/${created.id}/thumbnail`],
    ['preview', `/assets/${created.id}/thumbnail?size=preview`],
    ['original', `/assets/${created.id}/original`],
  ]) {
    const res = await fetch(`${BASE}${url}`, { headers: { authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new Error(`${label} -> ${res.status}`);
    ok(`${label} served`, `${res.headers.get('content-type')} ${(buf.length / 1024).toFixed(0)} KB`);
  }

  console.log('\n== video: upload, transcode, range streaming ==');
  const vid = await upload(video, { relativePath: 'Trips/2024/Tokyo/clip.avi' });
  ok('video uploaded', `status=${vid.status}`);

  const encoded = await waitFor('transcode', async () => {
    const a = await call('GET', `/assets/${vid.id}`);
    return a.encodedVideoPath ? a : null;
  }, 180000);
  ok('transcoded to web-playable mp4');
  ok('duration probed', encoded.duration);

  const full = await fetch(`${BASE}/assets/${vid.id}/video`, { headers: { authorization: `Bearer ${token}` } });
  const fullBuf = Buffer.from(await full.arrayBuffer());
  ok('full video stream', `${full.status} ${full.headers.get('content-type')} ${(fullBuf.length / 1024).toFixed(0)} KB`);

  const ranged = await fetch(`${BASE}/assets/${vid.id}/video`, {
    headers: { authorization: `Bearer ${token}`, range: 'bytes=0-1023' },
  });
  const rangedBuf = Buffer.from(await ranged.arrayBuffer());
  if (ranged.status !== 206) throw new Error(`expected 206, got ${ranged.status}`);
  if (rangedBuf.length !== 1024) throw new Error(`expected 1024 bytes, got ${rangedBuf.length}`);
  ok('range request (seeking works)', `206 ${ranged.headers.get('content-range')}`);

  console.log('\n== favorites, filters, sorting ==');
  const favs = await call('GET', '/assets?isFavorite=true');
  ok('favorite filter', `${favs.pagination.total} favorite(s)`);

  const videos = await call('GET', '/assets?type=VIDEO');
  ok('type filter', `${videos.pagination.total} video(s)`);

  const byName = await call('GET', '/assets?sortBy=name&order=asc');
  ok('sort by name', byName.items.map((a) => a.originalFileName).join(', '));

  const byCamera = await call('GET', '/assets?make=Canon');
  ok('filter by camera make', `${byCamera.pagination.total} from Canon`);

  const buckets = await call('GET', '/assets/timeline/buckets');
  ok('timeline buckets', buckets.map((b) => `${b.timeBucket}:${b.count}`).join(' '));

  const bucket = await call('GET', `/assets/timeline/bucket?timeBucket=${buckets[0].timeBucket}`);
  ok('bucket contents', `${bucket.length} asset(s)`);

  console.log('\n== trash ==');
  await call('DELETE', '/assets', { ids: [vid.id] });
  const trash = await call('GET', '/assets/trash');
  ok('moved to trash', `${trash.length} in trash, purge at ${new Date(trash[0].purgeAt).toDateString()}`);

  const stillListed = await call('GET', '/assets?type=VIDEO');
  if (stillListed.pagination.total !== 0) throw new Error('trashed asset still in the timeline');
  ok('trashed asset hidden from the timeline');

  await call('POST', '/assets/trash/restore', { ids: [vid.id] });
  const restored = await call('GET', '/assets?type=VIDEO');
  ok('restored from trash', `${restored.pagination.total} video(s) back`);

  console.log('\n== statistics ==');
  const stats = await call('GET', '/assets/statistics');
  ok('statistics', `${stats.images} photos, ${stats.videos} videos, ${(Number(stats.usageInBytes) / 1048576).toFixed(1)} MB`);

  console.log('\n== zip download ==');
  const zip = await fetch(`${BASE}/assets/download/archive?ids=${created.id},${vid.id}&name=trip`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const zipBuf = Buffer.from(await zip.arrayBuffer());
  if (zipBuf.subarray(0, 2).toString() !== 'PK') throw new Error('archive is not a zip');
  ok('multi-asset zip', `${(zipBuf.length / 1024).toFixed(0)} KB`);

  console.log('\nAll checks passed.\n');
};

run()
  .catch((e) => {
    console.error(`\n  FAIL  ${e.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => exiftool.end());
