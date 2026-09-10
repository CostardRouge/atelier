/**
 * Rasterise the home-screen / favicon PNGs from the SVG sources in
 * `public/icons/`, and commit the result.
 *
 * WHY PNGs AT ALL. An SVG favicon is enough for a desktop tab and for nothing
 * else. iOS builds a home-screen icon from `<link rel="apple-touch-icon">`
 * only — a PNG, square, opaque — and ignores `rel="icon"` whatever its type;
 * with no such link it screenshots the page instead, which is what "the icon
 * is broken on iPhone" always turns out to mean. Android's launcher wants the
 * manifest's 192/512 PNGs, and a maskable pair on top so its own shape mask
 * never clips the drawing. None of that can be produced at request time on a
 * static host, so it is rasterised here, once, and the output is tracked.
 *
 * USAGE:  npm i --no-save sharp   (once; deliberately NOT a project dependency
 *                                 — this runs by hand, and CI would pay for a
 *                                 native install on every job)
 *         node scripts/gen-icons.mjs
 *
 * Re-run it after editing any of the three sources, and commit the PNGs in the
 * same commit: the SVG is not what ships to a phone.
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/**
 * `flatten` drops the alpha channel. It is on for the touch icon only: iOS
 * composites a transparent pixel onto BLACK, so an icon with rounded corners
 * of its own comes back framed in a dark vignette under Apple's mask. The
 * rounded tile keeps its transparent corners everywhere else, where they are
 * exactly what is wanted.
 *
 * @type {{ src: string; out: string; size: number; flatten?: boolean; why: string }[]}
 */
const JOBS = [
  // Manifest "any" icons — Chrome/Android install, and the tab on high-DPI.
  { src: 'icon.svg', out: 'icon-192.png', size: 192, why: 'manifest, any' },
  { src: 'icon.svg', out: 'icon-512.png', size: 512, why: 'manifest, any + splash' },
  // Maskable pair — Android adaptive launcher shapes.
  { src: 'icon-maskable.svg', out: 'icon-maskable-192.png', size: 192, why: 'manifest, maskable' },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512, why: 'manifest, maskable' },
  // The one iOS reads. 180 is what current iPhones ask for; iOS downsamples
  // for every other slot, so a single size is enough.
  { src: 'icon-apple.svg', out: 'apple-touch-icon.png', size: 180, flatten: true, why: 'iOS home screen' },
  // Raster favicons, for the browsers that still prefer one to the SVG.
  { src: 'icon.svg', out: 'favicon-32.png', size: 32, why: 'tab' },
  { src: 'icon.svg', out: 'favicon-16.png', size: 16, why: 'tab' },
];

for (const job of JOBS) {
  const svg = readFileSync(join(ICONS_DIR, job.src));
  let pipeline = sharp(svg, { density: 384 }).resize(job.size, job.size);
  if (job.flatten) pipeline = pipeline.flatten({ background: '#f4f0e7' });
  await pipeline.png().toFile(join(ICONS_DIR, job.out));
  console.log(`✓ ${job.out} (${job.size}×${job.size}) — ${job.why}`);
}

console.log('Done. Commit the PNGs alongside the SVG you changed.');
