// Generates a small varied library so the layout can be judged with real
// aspect ratios. Development helper only.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { exiftool } from 'exiftool-vendored';

const BASE = 'http://127.0.0.1:3001/api';
const TMP = join(process.cwd(), '.seed-media');

const SHOTS = [
  ['sunrise-over-the-bay', 3000, 2000, 'testsrc2', '2024:06:12 06:14:02', '+09:00', 'Trips/2024/Tokyo'],
  ['harbour-panorama', 3600, 1200, 'smptebars', '2024:06:12 09:31:44', '+09:00', 'Trips/2024/Tokyo'],
  ['temple-doorway', 1400, 2100, 'testsrc', '2024:06:12 11:02:10', '+09:00', 'Trips/2024/Tokyo'],
  ['street-market', 2400, 1600, 'rgbtestsrc', '2024:06:12 13:45:00', '+09:00', 'Trips/2024/Tokyo'],
  ['neon-alley', 1600, 2400, 'testsrc2', '2024:06:12 20:15:33', '+09:00', 'Trips/2024/Tokyo'],
  ['ferry-crossing', 2800, 1575, 'smptehdbars', '2024:06:13 08:20:11', '+09:00', 'Trips/2024/Kyoto'],
  ['bamboo-path', 1800, 2400, 'testsrc', '2024:06:13 10:05:52', '+09:00', 'Trips/2024/Kyoto'],
  ['tea-house', 2400, 1800, 'rgbtestsrc', '2024:06:13 15:30:00', '+09:00', 'Trips/2024/Kyoto'],
  ['river-walk', 3000, 1250, 'testsrc2', '2024:06:13 17:48:20', '+09:00', 'Trips/2024/Kyoto'],
  ['garden-steps', 2000, 2000, 'smptebars', '2024:06:14 09:00:00', '+09:00', 'Trips/2024/Kyoto'],
  ['mountain-ridge', 3200, 1800, 'testsrc', '2023:09:02 07:12:00', '+02:00', 'Trips/2023/Alps'],
  ['cabin-window', 1500, 2000, 'rgbtestsrc', '2023:09:02 18:40:00', '+02:00', 'Trips/2023/Alps'],
  ['lake-reflection', 2600, 1733, 'testsrc2', '2023:09:03 06:55:00', '+02:00', 'Trips/2023/Alps'],
  ['forest-trail', 1900, 2400, 'smptehdbars', '2023:09:03 12:10:00', '+02:00', 'Trips/2023/Alps'],
];

const CLIPS = [
  ['ferry-departure', 1920, 1080, 4, 'Trips/2024/Tokyo'],
  ['rain-on-the-window', 1080, 1920, 3, 'Trips/2024/Kyoto'],
];

const login = async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL ?? 'admin@imadeo.local',
      password: process.env.ADMIN_PASSWORD ?? 'imadeo-admin',
    }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return (await res.json()).accessToken;
};

const upload = async (token, path, name, relativePath) => {
  const form = new FormData();
  form.append('assetData', new Blob([readFileSync(path)]), name);
  form.append('relativePath', `${relativePath}/${name}`);

  const res = await fetch(`${BASE}/assets/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

const run = async () => {
  mkdirSync(TMP, { recursive: true });
  const token = await login();
  let created = 0;
  let duplicates = 0;

  for (const [slug, w, h, source, taken, offset, folder] of SHOTS) {
    const name = `${slug}.jpg`;
    const file = join(TMP, name);

    execFileSync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', `${source}=size=${w}x${h}:duration=1`, '-frames:v', '1', '-q:v', '3', file],
      { stdio: 'pipe' },
    );

    await exiftool.write(
      file,
      {
        Make: 'Fujifilm',
        Model: 'X-T5',
        LensModel: 'XF 23mm f/1.4',
        DateTimeOriginal: taken,
        OffsetTimeOriginal: offset,
        FNumber: 2.8,
        ISO: 320,
        FocalLength: 23,
        Description: slug.replaceAll('-', ' '),
      },
      { writeArgs: ['-overwrite_original'] },
    );

    const result = await upload(token, file, name, folder);
    if (result.status === 'duplicate') duplicates += 1;
    else created += 1;
    process.stdout.write(`  ${result.status.padEnd(9)} ${folder}/${name}\n`);
  }

  for (const [slug, w, h, seconds, folder] of CLIPS) {
    const name = `${slug}.mp4`;
    const file = join(TMP, name);

    execFileSync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:duration=${seconds}`,
       '-f', 'lavfi', '-i', `sine=frequency=320:duration=${seconds}`,
       '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
       '-c:a', 'aac', '-shortest', '-movflags', '+faststart', file],
      { stdio: 'pipe' },
    );

    const result = await upload(token, file, name, folder);
    if (result.status === 'duplicate') duplicates += 1;
    else created += 1;
    process.stdout.write(`  ${result.status.padEnd(9)} ${folder}/${name}\n`);
  }

  rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${created} added, ${duplicates} already present.`);
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => exiftool.end());
