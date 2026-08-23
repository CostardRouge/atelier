/**
 * Generate the starter `.cube` 3D LUTs shipped in `public/luts/`.
 *
 * These are intentionally simple, reproducible looks so the LUT Studio has
 * something to demonstrate out of the box. Replace or extend them by editing
 * this script and re-running `node scripts/gen-luts.mjs`, then committing the
 * regenerated files (and adding an entry to `src/lut/builtin-luts.ts`).
 *
 * Affine looks (tints, channel mixes, black & white) are exact at size 2,
 * because trilinear interpolation reproduces any affine colour transform
 * exactly. Non-linear looks (the contrast S-curve) use a larger grid.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The starter looks live under `luts/classic/`; the picker groups them by
// folder, and user-supplied looks go in sibling folders (apple/, dji/, …).
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'luts',
  'classic',
);

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Render a `.cube` text body from a per-input mapping fn (r,g,b in [0,1]). */
function buildCube(title, size, mapFn) {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`, ''];
  // Red varies fastest, then green, then blue — `.cube` table order.
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const inR = r / (size - 1);
        const inG = g / (size - 1);
        const inB = b / (size - 1);
        const [oR, oG, oB] = mapFn(inR, inG, inB);
        lines.push(`${clamp01(oR).toFixed(6)} ${clamp01(oG).toFixed(6)} ${clamp01(oB).toFixed(6)}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

/** Build a mapping fn from a 3×3 matrix and an offset (affine). */
const matrix = (m, off = [0, 0, 0]) => (r, g, b) => [
  m[0][0] * r + m[0][1] * g + m[0][2] * b + off[0],
  m[1][0] * r + m[1][1] * g + m[1][2] * b + off[1],
  m[2][0] * r + m[2][1] * g + m[2][2] * b + off[2],
];

const REC709 = [0.2126, 0.7152, 0.0722];

// Smoothstep gives a gentle S-curve; mix with identity to control strength.
const smoothstep = (x) => x * x * (3 - 2 * x);
const sCurve = (amount) => (x) => x * (1 - amount) + smoothstep(x) * amount;

const luts = [
  {
    file: 'neutral.cube',
    text: buildCube('Neutral (identity)', 2, (r, g, b) => [r, g, b]),
  },
  {
    file: 'warm.cube',
    text: buildCube(
      'Warm',
      2,
      matrix(
        [
          [1.0, 0.0, 0.0],
          [0.0, 0.97, 0.0],
          [0.0, 0.0, 0.86],
        ],
        [0.03, 0.015, 0.0],
      ),
    ),
  },
  {
    file: 'cool.cube',
    text: buildCube(
      'Cool',
      2,
      matrix(
        [
          [0.86, 0.0, 0.0],
          [0.0, 0.97, 0.0],
          [0.0, 0.0, 1.0],
        ],
        [0.0, 0.015, 0.03],
      ),
    ),
  },
  {
    file: 'black-and-white.cube',
    text: buildCube('Black & White', 2, (r, g, b) => {
      const y = REC709[0] * r + REC709[1] * g + REC709[2] * b;
      return [y, y, y];
    }),
  },
  {
    file: 'sepia.cube',
    text: buildCube(
      'Sepia',
      2,
      matrix([
        [0.393, 0.769, 0.189],
        [0.349, 0.686, 0.168],
        [0.272, 0.534, 0.131],
      ]),
    ),
  },
  {
    file: 'filmic-contrast.cube',
    text: buildCube('Filmic Contrast', 17, (r, g, b) => {
      const curve = sCurve(0.55);
      return [curve(r), curve(g), curve(b)];
    }),
  },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, text } of luts) {
  writeFileSync(join(OUT_DIR, file), text);
  console.log(`wrote ${file} (${text.length} bytes)`);
}
