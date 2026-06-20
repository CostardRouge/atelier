/**
 * Pure scope maths — no DOM, no canvas. Given the RGBA bytes of a (downscaled)
 * frame, build the data behind the three classic video scopes:
 *
 * - **Histogram** — per-channel and luma value distribution (256 bins).
 * - **Waveform** — per image column, the distribution of brightness, so you
 *   read exposure across the frame left-to-right.
 * - **Vectorscope** — pixels plotted on the Cb/Cr chroma plane, so you read hue
 *   and saturation (distance from the neutral centre).
 *
 * Kept pure so the same code is unit-tested and could run in a worker. Drawing
 * lives in `draw-scopes.ts`.
 */

/** Rec.709 luma (0..255) from 8-bit RGB — HD's standard weighting. */
export function luma709(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface Histograms {
  /** Each is a 256-length count array indexed by 8-bit value. */
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  /** Largest bin across all channels, for normalising the draw. */
  max: number;
}

export function computeHistograms(rgba: Uint8ClampedArray): Histograms {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const luma = new Uint32Array(256);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue; // skip fully-transparent
    const R = rgba[i];
    const G = rgba[i + 1];
    const B = rgba[i + 2];
    r[R]++;
    g[G]++;
    b[B]++;
    luma[Math.round(luma709(R, G, B))]++;
  }
  let max = 0;
  for (let i = 0; i < 256; i++) {
    if (r[i] > max) max = r[i];
    if (g[i] > max) max = g[i];
    if (b[i] > max) max = b[i];
  }
  return { r, g, b, luma, max };
}

export interface Waveform {
  /** Number of image columns (the frame's downscaled width). */
  width: number;
  /** Each is `width * 256`, indexed `[x * 256 + level]`. */
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
}

export function computeWaveform(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Waveform {
  const r = new Uint32Array(width * 256);
  const g = new Uint32Array(width * 256);
  const b = new Uint32Array(width * 256);
  const luma = new Uint32Array(width * 256);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (rgba[o + 3] === 0) continue;
      const R = rgba[o];
      const G = rgba[o + 1];
      const B = rgba[o + 2];
      const base = x * 256;
      r[base + R]++;
      g[base + G]++;
      b[base + B]++;
      luma[base + Math.round(luma709(R, G, B))]++;
    }
  }
  return { width, r, g, b, luma };
}

export interface Vectorscope {
  /** Square grid edge length. */
  size: number;
  /** `size * size` counts, indexed `[y * size + x]`; centre is neutral. */
  data: Uint32Array;
  /** Busiest cell, for normalising the draw. */
  max: number;
}

/**
 * Plot each pixel on the Rec.709 Cb/Cr plane. `x` grows with Cb (blue−yellow),
 * `y` grows downward with −Cr (so red/magenta sit toward the top, matching a
 * conventional vectorscope). Neutral greys land at the exact centre.
 */
export function computeVectorscope(rgba: Uint8ClampedArray, size = 256): Vectorscope {
  const data = new Uint32Array(size * size);
  const half = size / 2;
  let max = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const R = rgba[i];
    const G = rgba[i + 1];
    const B = rgba[i + 2];
    const cb = -0.1146 * R - 0.3854 * G + 0.5 * B;
    const cr = 0.5 * R - 0.4542 * G - 0.0458 * B;
    let gx = Math.round((cb / 128) * half + half);
    let gy = Math.round(half - (cr / 128) * half);
    if (gx < 0) gx = 0;
    else if (gx >= size) gx = size - 1;
    if (gy < 0) gy = 0;
    else if (gy >= size) gy = size - 1;
    const v = ++data[gy * size + gx];
    if (v > max) max = v;
  }
  return { size, data, max };
}
