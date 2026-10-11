/**
 * What a THUMBNAIL can say of a photograph, measured once on a small raster
 * and read by several askers — "my blue photos", the sharpest of a burst, a
 * frame too dark to keep, a story that does not repeat itself:
 *
 * - SHARPNESS: the variance of a Laplacian over the luma — texture and edges
 *   score high, a blur or a flat sky low. It is a RELATIVE measure: it tells
 *   twins apart and ranks a burst; it does not say "sharp" of a lone frame.
 * - EXPOSURE: the strip's own histogram reading (`histogram.ts`) — mean,
 *   percentiles, clipped and crushed shares.
 * - COLOUR: the share of chromatic pixels in eight hue families, the dominant
 *   one, and a warmth from −1 (cool) to 1 (warm).
 * - A HASH: an 8 × 8 difference hash of the luma (64 bits), so two frames of
 *   one burst, or a copy re-encoded, read as near — Hamming distance.
 *
 * Measured on a thumbnail (~128 px), never on the file: a sample good enough
 * to sort by, and said as such wherever it is answered.
 *
 * Pure and DOM-free: a raster is RGBA bytes with a size, as `ImageData` hands them.
 */

import { histogramReading, luminanceHistogram, type HistogramReading } from '../develop/histogram';

export interface Raster {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export const HUE_FAMILIES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'] as const;
export type HueFamily = (typeof HUE_FAMILIES)[number];

/** Below this saturation (0..1) a pixel is grey and votes for no hue. */
const CHROMA_FLOOR = 0.15;
/** Outside these lightness bounds a pixel is black or white, whatever its hue. */
const LIGHT_FLOOR = 0.08;
const LIGHT_CEIL = 0.95;

export interface ColourReading {
  /** Share 0..1 of pixels that carry a hue at all; a monochrome frame is near 0. */
  chromatic: number;
  /** The share of chromatic pixels in each family, 0..1. */
  families: Record<HueFamily, number>;
  /** The family holding the most chromatic pixels, or null for a frame with none. */
  dominant: HueFamily | null;
  /** The mean colour of the chromatic pixels, as "#rrggbb"; the frame's mean when it has none. */
  hex: string;
  /** Warm (red · orange · yellow · magenta) minus cool (cyan · blue · purple) shares, −1..1. */
  warmth: number;
}

export interface ThumbMetrics {
  sharpness: number;
  exposure: HistogramReading;
  colour: ColourReading;
  hash: string;
}

export function thumbMetrics(raster: Raster): ThumbMetrics {
  return {
    sharpness: sharpness(raster),
    exposure: histogramReading(luminanceHistogram(raster.data)),
    colour: colourOf(raster),
    hash: dHash(raster),
  };
}

function luma(d: ArrayLike<number>, o: number): number {
  return 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
}

/**
 * The variance of the 4-neighbour Laplacian of the luma, divided by 255² so
 * the number does not depend on the raster's scale of values — around 0 for
 * a flat field, a few hundredths for a blur, tenths for texture in focus.
 */
export function sharpness({ data, width, height }: Raster): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const o = (y * width + x) * 4;
      const lap =
        4 * luma(data, o) - luma(data, o - 4) - luma(data, o + 4) - luma(data, o - width * 4) - luma(data, o + width * 4);
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.round(((sumSq / n - mean * mean) / (255 * 255)) * 1e6) / 1e6;
}

/** Hue 0..360, saturation and lightness 0..1 of an RGB byte triple (HSL). */
function hsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [((h * 60) % 360 + 360) % 360, s, l];
}

/** Which family a hue falls in, by the bands a person names colours with. */
export function hueFamily(hue: number): HueFamily {
  if (hue < 15 || hue >= 335) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 200) return 'cyan';
  if (hue < 260) return 'blue';
  if (hue < 300) return 'purple';
  return 'magenta';
}

const WARM: readonly HueFamily[] = ['red', 'orange', 'yellow', 'magenta'];
const COOL: readonly HueFamily[] = ['cyan', 'blue', 'purple'];

export function colourOf({ data }: Raster): ColourReading {
  const pixels = Math.floor(data.length / 4);
  const counts = Object.fromEntries(HUE_FAMILIES.map((f) => [f, 0])) as Record<HueFamily, number>;
  let chromatic = 0;
  const sumChroma = [0, 0, 0];
  const sumAll = [0, 0, 0];
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    sumAll[0] += r;
    sumAll[1] += g;
    sumAll[2] += b;
    const [h, s, l] = hsl(r, g, b);
    if (s < CHROMA_FLOOR || l < LIGHT_FLOOR || l > LIGHT_CEIL) continue;
    chromatic++;
    counts[hueFamily(h)]++;
    sumChroma[0] += r;
    sumChroma[1] += g;
    sumChroma[2] += b;
  }
  const families = Object.fromEntries(HUE_FAMILIES.map((f) => [f, chromatic ? round4(counts[f] / chromatic) : 0])) as Record<HueFamily, number>;
  let dominant: HueFamily | null = null;
  for (const f of HUE_FAMILIES) if (chromatic && counts[f] > 0 && (dominant === null || counts[f] > counts[dominant])) dominant = f;
  const mean = chromatic ? sumChroma.map((v) => v / chromatic) : pixels ? sumAll.map((v) => v / pixels) : [0, 0, 0];
  const warm = WARM.reduce((n, f) => n + families[f], 0);
  const cool = COOL.reduce((n, f) => n + families[f], 0);
  return {
    chromatic: pixels ? round4(chromatic / pixels) : 0,
    families,
    dominant,
    hex: `#${mean.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`,
    warmth: round4(warm - cool),
  };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** The luma of the raster box-averaged onto a `cols × rows` grid, row-major. */
function greyGrid({ data, width, height }: Raster, cols: number, rows: number): Float64Array {
  const out = new Float64Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    const y0 = Math.floor((gy * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          sum += luma(data, (y * width + x) * 4);
          n++;
        }
      }
      out[gy * cols + gx] = n ? sum / n : 0;
    }
  }
  return out;
}

/**
 * The 64-bit difference hash: the luma on a 9 × 8 grid, each cell compared
 * with its right neighbour. Insensitive to size, brightness and encoding;
 * two frames of a burst differ in a handful of bits, two pictures in ~32.
 */
export function dHash(raster: Raster): string {
  const grid = greyGrid(raster, 9, 8);
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) {
      byte = (byte << 1) | (grid[y * 9 + x] < grid[y * 9 + x + 1] ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** How many bits two hashes differ by, 0..64. */
export function hammingDistance(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n + Math.abs(a.length - b.length) * 4;
}

/** What an agent may ask of a frame's colour. */
export const COLOUR_ASKS = [...HUE_FAMILIES, 'warm', 'cool', 'neutral', 'mono'] as const;
export type ColourAsk = (typeof COLOUR_ASKS)[number];

/** The share a family must reach for the frame to be "that colour" when it is not the dominant one. */
const FAMILY_SHARE = 0.3;
/** Past this warmth the frame reads warm (or cool past its negative). */
const WARMTH_EDGE = 0.3;
/** Under this chromatic share the frame reads neutral; under a fifth of it, monochrome. */
const NEUTRAL_CHROMA = 0.2;

/** Whether a frame answers a colour ask, from its reading. */
export function passesColour(c: ColourReading, ask: ColourAsk): boolean {
  switch (ask) {
    case 'mono':
      return c.chromatic < NEUTRAL_CHROMA / 5;
    case 'neutral':
      return c.chromatic < NEUTRAL_CHROMA;
    case 'warm':
      return c.chromatic >= NEUTRAL_CHROMA && c.warmth > WARMTH_EDGE;
    case 'cool':
      return c.chromatic >= NEUTRAL_CHROMA && c.warmth < -WARMTH_EDGE;
    default:
      return c.chromatic >= NEUTRAL_CHROMA && (c.dominant === ask || c.families[ask] >= FAMILY_SHARE);
  }
}
