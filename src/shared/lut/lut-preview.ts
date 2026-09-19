/**
 * Baking a LUT onto a small sample image for a preview thumbnail — the maths
 * only, DOM-free so it is unit-tested in a node environment. `LutGalleryModal`
 * supplies the sample (a decoded photo, or this module's synthetic chart) and
 * draws the result to a canvas; this module never touches the DOM.
 */

import type { CubeLut } from '../lib/cube-parser';
import { sampleWith, type Interpolation } from './interpolate';

/** A small RGBA8 bitmap, laid out like `ImageData.data`. */
export interface RgbBitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Thumbnail sample resolution — plenty to judge a look, cheap to bake ~30 of. */
export const PREVIEW_SAMPLE_SIZE = 96;

const BARS: readonly [number, number, number][] = [
  [0.82, 0.11, 0.13], // red
  [0.91, 0.52, 0.09], // orange
  [0.86, 0.78, 0.12], // yellow
  [0.16, 0.6, 0.24], // green
  [0.12, 0.55, 0.62], // cyan
  [0.14, 0.24, 0.72], // blue
  [0.55, 0.16, 0.58], // magenta
];
const SKIN: readonly [number, number, number] = [0.82, 0.63, 0.52];
const FOLIAGE: readonly [number, number, number] = [0.27, 0.42, 0.18];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A procedural test chart, used when no real photo is offered to preview on:
 * a sky gradient, a neutral grey ramp (tetrahedral keeps it neutral),
 * saturated primaries, a skin-tone patch and a foliage patch — the handful of
 * things a look actually changes, so a swatch says more than a random photo.
 */
export function syntheticPreviewSample(size = PREVIEW_SAMPLE_SIZE): RgbBitmap {
  const data = new Uint8ClampedArray(size * size * 4);
  const last = Math.max(1, size - 1);

  for (let y = 0; y < size; y += 1) {
    const v = y / last;
    for (let x = 0; x < size; x += 1) {
      const u = x / last;
      let r: number;
      let g: number;
      let b: number;

      if (v < 0.38) {
        // Sky: light blue at the top fading to a warm horizon.
        const t = v / 0.38;
        r = lerp(0.56, 0.95, t);
        g = lerp(0.78, 0.85, t);
        b = lerp(0.92, 0.72, t);
      } else if (v < 0.52) {
        // Neutral grey ramp, black (left) to white (right).
        r = g = b = u;
      } else if (v < 0.76) {
        const i = Math.min(BARS.length - 1, Math.floor(u * BARS.length));
        [r, g, b] = BARS[i];
      } else {
        [r, g, b] = u < 0.5 ? SKIN : FOLIAGE;
      }

      const o = (y * size + x) * 4;
      data[o] = Math.round(r * 255);
      data[o + 1] = Math.round(g * 255);
      data[o + 2] = Math.round(b * 255);
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/**
 * Bake `lut` onto `sample`, blended by `intensity` exactly as the GPU shader
 * does (`mix(original, graded, intensity)`, `lut-gl.ts`) — so a thumbnail
 * reads the same as the real grade would. `lut === null` returns an
 * unchanged copy: the "original" tile.
 */
export function bakeLutPreview(
  sample: RgbBitmap,
  lut: CubeLut | null,
  intensity: number,
  mode: Interpolation,
): RgbBitmap {
  const { width, height, data } = sample;
  const out = new Uint8ClampedArray(data.length);
  if (!lut) {
    out.set(data);
    return { width, height, data: out };
  }
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const [lr, lg, lb] = sampleWith(lut, r, g, b, mode);
    out[i] = Math.round((r + (lr - r) * intensity) * 255);
    out[i + 1] = Math.round((g + (lg - g) * intensity) * 255);
    out[i + 2] = Math.round((b + (lb - b) * intensity) * 255);
    out[i + 3] = data[i + 3];
  }
  return { width, height, data: out };
}
