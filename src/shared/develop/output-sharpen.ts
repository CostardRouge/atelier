/**
 * OUTPUT SHARPENING — the last touch on a delivered file, after it has been
 * resized for its target (audit item 28): Lightroom's *Sharpen for Screen*.
 *
 * A downscale is a low-pass filter; the edges a 36-megapixel picture had at
 * its own size come out soft at 2048 px. The picture's own sharpen
 * (`render/detail.ts`) is judged at the picture's density and cannot know
 * the size a target will ask, so this is a separate, small step applied to
 * the file alone.
 *
 * What it is: a 3×3 binomial unsharp mask on LUMA — the difference added to
 * the three channels alike, so an edge gains contrast and no colour fringe —
 * with a soft threshold that leaves a flat sky's last code of noise alone.
 * Three strengths; none has a radius to set, because the radius that suits a
 * screen is one output pixel whatever the target.
 *
 * Pure and DOM-free: the renderer reads the canvas in BANDS of rows
 * (`sharpenRows`), so a large file never needs a second full-size buffer.
 */

import type { OutputSharpen } from './export-targets';

/** How much of the difference is added back, per level. */
export const OUTPUT_SHARPEN_AMOUNT: Readonly<Record<OutputSharpen, number>> = {
  off: 0,
  low: 0.4,
  standard: 0.8,
  high: 1.3,
};

/** Below this difference, in 8-bit codes, the gain fades out: noise is not detail. */
export const OUTPUT_SHARPEN_THRESHOLD = 2;

const luma = (d: Uint8ClampedArray, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/**
 * Rows `[from, to)` of an RGBA buffer `w` wide and `h` tall, sharpened, as a
 * new buffer of `(to − from) × w × 4` bytes. Neighbours outside the buffer are
 * its edge repeated, so a band read with one row either side of what it
 * writes gives the same pixels as the whole picture done at once. Alpha is
 * copied.
 */
export function sharpenRows(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  from: number,
  to: number,
  amount: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer((to - from) * w * 4));
  if (amount <= 0) {
    out.set(src.subarray(from * w * 4, to * w * 4));
    return out;
  }
  // Luma of the three rows the kernel reads, reused as the band walks down.
  const rowLuma = (y: number): Float32Array => {
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
    const row = new Float32Array(w);
    for (let x = 0; x < w; x += 1) row[x] = luma(src, (yy * w + x) * 4);
    return row;
  };
  let above = rowLuma(from - 1);
  let here = rowLuma(from);
  for (let y = from; y < to; y += 1) {
    const below = rowLuma(y + 1);
    for (let x = 0; x < w; x += 1) {
      const l = x > 0 ? x - 1 : 0;
      const r = x < w - 1 ? x + 1 : w - 1;
      // The binomial [1 2 1] ⊗ [1 2 1] / 16 — sigma ≈ 0.85 px.
      const blur =
        (above[l] + 2 * above[x] + above[r] + 2 * (here[l] + 2 * here[x] + here[r]) + below[l] + 2 * below[x] + below[r]) / 16;
      const diff = here[x] - blur;
      const mag = Math.abs(diff);
      const gain = (amount * mag) / (mag + OUTPUT_SHARPEN_THRESHOLD);
      const add = diff * gain;
      const i = (y * w + x) * 4;
      const o = ((y - from) * w + x) * 4;
      out[o] = src[i] + add;
      out[o + 1] = src[i + 1] + add;
      out[o + 2] = src[i + 2] + add;
      out[o + 3] = src[i + 3];
    }
    above = here;
    here = below;
  }
  return out;
}

/** The rows a band is processed in: small enough that a 60 MP file never holds a second copy of itself. */
export const SHARPEN_BAND_ROWS = 256;
