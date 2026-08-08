/**
 * Renders the app icons from the Imadeo mark.
 *
 * The mark lives in `mobile/src/components/Logo.tsx` as react-native-svg, which
 * only React Native can draw — so the same geometry is restated here as plain
 * SVG and rasterised with sharp, which the server already depends on. The two
 * have to be changed together; that is the cost of the mark being a component
 * rather than a file, and it is cheaper than hand-exporting six PNGs.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'mobile', 'assets');

/** The brand ramp from `mobile/src/theme.ts`. Nothing here invents a colour. */
const BRAND = ['#7cdbff', '#3fc9ff', '#0369a1'];

/**
 * The two overlapping frames, on a 64-unit grid.
 *
 * `inset` shrinks the drawing inside its canvas. Android's adaptive icon crops
 * to a circle that can be as small as 66% of the layer, so the foreground has
 * to sit well inside its own square or the corners of the frames are shaved off
 * on a round-masked launcher.
 */
const mark = (inset = 1) => {
  const scale = inset;
  const shift = (64 - 64 * scale) / 2;
  return `
  <g transform="translate(${shift} ${shift}) scale(${scale})">
    <clipPath id="photo">
      <rect x="12" y="14" width="26" height="24" rx="5"/>
    </clipPath>
    <rect x="12" y="14" width="26" height="24" rx="5" fill="#fbbf24"/>
    <circle cx="19" cy="21" r="2.6" fill="#fff"/>
    <!--
      Clipped to the frame it is inside.

      The horizon runs to y=44 while the frame stops at 38, so unclipped it
      spilled six units out of the bottom of the photo and squared off a corner
      that is meant to be round. On screen at 26px nobody saw it; at 1024 it is
      the first thing you see.
    -->
    <path d="M12 34l6-6 4 4 4-4 12 10H12z" fill="#f97316" clip-path="url(#photo)"/>
    <rect x="26" y="27" width="26" height="24" rx="5" fill="#7cdbff" stroke="#0369a1" stroke-width="3"/>
    <path d="M35 33.5l9 5.5-9 5.5z" fill="#0369a1"/>
  </g>`;
};

/**
 * The tile, running from the primary into the deep end of the ramp.
 *
 * The full three-stop ramp starts at `secondary`, which is within a shade of
 * the video frame laid on top of it — the frame simply disappeared into its own
 * background. Starting at `primary` and falling to the darkest stop keeps the
 * pale frames legible. Same three brand colours, no new one.
 */
const gradient = `
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND[1]}"/>
      <stop offset="1" stop-color="${BRAND[2]}"/>
    </linearGradient>
  </defs>`;

/**
 * The square iOS wants.
 *
 * Fully opaque and square-cornered on purpose: iOS rounds and masks the icon
 * itself, and an icon that arrives pre-rounded with transparent corners is
 * rejected at submission.
 */
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024">
  ${gradient}
  <rect width="64" height="64" fill="url(#tile)"/>
  ${mark(0.92)}
</svg>`;

/** Android draws its own background layer, so this one is the mark alone. */
const androidForeground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024">
  ${mark(0.62)}
</svg>`;

const androidBackground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024">
  ${gradient}
  <rect width="64" height="64" fill="url(#tile)"/>
</svg>`;

/**
 * One flat silhouette for themed icons.
 *
 * Android tints this layer itself, so every shape has to be the same solid
 * colour — colour here would be thrown away, and detail would turn to mud.
 */
const androidMonochrome = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024">
  <g transform="translate(12.16 12.16) scale(0.62)" fill="#000">
    <rect x="12" y="14" width="26" height="24" rx="5"/>
    <rect x="26" y="27" width="26" height="24" rx="5" stroke="#fff" stroke-width="3"/>
  </g>
</svg>`;

/** Transparent: the splash sits on its own background colour. */
const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024">
  ${mark(0.85)}
</svg>`;

/**
 * `flat` strips the alpha channel.
 *
 * App Store Connect rejects an app icon that carries one, even when every pixel
 * is opaque — the channel's presence is the failure, not what is in it. The
 * layers that genuinely need transparency, the Android foreground and the
 * splash, keep theirs.
 */
const outputs = [
  { name: 'icon.png', svg: appIcon, size: 1024, flat: true },
  { name: 'android-icon-foreground.png', svg: androidForeground, size: 1024 },
  { name: 'android-icon-background.png', svg: androidBackground, size: 1024, flat: true },
  { name: 'android-icon-monochrome.png', svg: androidMonochrome, size: 1024 },
  { name: 'splash-icon.png', svg: splash, size: 1024 },
  { name: 'favicon.png', svg: appIcon, size: 96, flat: true },
];

mkdirSync(assets, { recursive: true });

for (const { name, svg, size, flat } of outputs) {
  let pipeline = sharp(Buffer.from(svg)).resize(size, size);
  if (flat) pipeline = pipeline.flatten({ background: BRAND[2] });
  const png = await pipeline.png().toBuffer();
  writeFileSync(join(assets, name), png);

  const { hasAlpha } = await sharp(png).metadata();
  console.log(`${name.padEnd(30)} ${size}x${size}  alpha=${hasAlpha}  ${(png.length / 1024).toFixed(1)} KB`);
}
