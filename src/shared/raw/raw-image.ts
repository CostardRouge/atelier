/**
 * What a RAW decode becomes, in numbers — the pure half of `raw-decoder.ts`.
 *
 * LibRaw hands back 16-bit RGB with dcraw's DEFAULT curve on it whatever the
 * `gamm` option says (measured: 0.5 of sensor white came back as 0.7059, which
 * is BT.709's `1.099·x^0.45 − 0.099` to four places, and every gamma setting
 * gave the same bytes). So the curve is inverted here, exactly: sixteen bits
 * carry it without loss, and a linear value is what a develop is defined on.
 *
 * From there: the picture's own exposure is MEASURED, not invented — the
 * brightest percentile of the frame is taken as white, dcraw's own auto-bright
 * rule (`-W` off, 1 % clipped) — and kept as a number the develop carries, so
 * the same gain is applied at export from a decode of another size. Then the
 * linear values are sRGB-ENCODED into half-floats for the GPU
 * (`render/half-image.ts`), with the sensor's saturation at 1.0: the cube's
 * develop stage decodes, multiplies by the gain and develops, which is where
 * "highlights −100" reaches into everything the sensor kept above the
 * displayed white.
 *
 * **Memory is the shape of this module (2026-09-23).** The first version
 * turned the whole 16-bit decode into a full-size Float32 picture, then
 * box-averaged that, then encoded that into another Float32 picture, then
 * packed it: for a DJI DNG at LibRaw's half size that is 110 + 27 + 27 MB of
 * transient arrays on top of the 55 MB decode, and an iPhone killed the tab
 * for it. Every step is a pure function of ONE 16-bit code, or of a box of
 * them, so nothing full-size has to exist in between:
 *
 * - **Box-averaged** (`boxLinearRows`): the target-size linear picture is
 *   written straight from the 16-bit codes through the BT.709 table, a band
 *   of rows at a time — the decoder yields to the main thread between bands
 *   and can be cancelled between them.
 * - **Whole** (`halfTableFromLibRaw`, `byteTableFromLibRaw`): a 16-bit code
 *   maps to exactly one half-float and, for a given gain, exactly one byte,
 *   so a 65536-entry table each is the whole conversion and no float picture
 *   exists at all.
 *
 * Both paths produce, bit for bit, what `boxDownscale(linearFromLibRaw(…))`
 * followed by `halfImageFromLinear` and `bytesFromLinear` produce — the
 * specs pin it — so preview = export still holds and no stored gain moved.
 *
 * Pure and DOM-free; every function here is exercised by a spec.
 */

import { fromLinear } from '../lut/transfer';
import { toHalf, type HalfImage } from '../render/half-image';

/** The three floats per pixel a RAW becomes before it is packed. */
export interface LinearRgb {
  width: number;
  height: number;
  /** Linear light, sensor white at 1, RGB, top row first. */
  data: Float32Array;
}

const BT709_KNEE = 0.018;
const BT709_A = 1.099;
const BT709_B = 0.099;
const BT709_SLOPE = 4.5;
/** Where the two branches of the ENCODED curve meet, `4.5 × 0.018`. */
const BT709_KNEE_ENCODED = BT709_SLOPE * BT709_KNEE;

/** dcraw's default output curve (BT.709), decoded: an encoded code in [0,1] → linear light. */
export function bt709ToLinear(encoded: number): number {
  if (encoded <= 0) return 0;
  if (encoded < BT709_KNEE_ENCODED) return encoded / BT709_SLOPE;
  return Math.pow((encoded + BT709_B) / BT709_A, 1 / 0.45);
}

/** The curve itself, for the spec that pins the inversion. */
export function linearToBt709(linear: number): number {
  if (linear <= 0) return 0;
  if (linear < BT709_KNEE) return linear * BT709_SLOPE;
  return BT709_A * Math.pow(linear, 0.45) - BT709_B;
}

/**
 * The decoder's curve inverted over every 16-bit code — 256 KB, built once
 * per page. The ONE table both decode paths read: a code's linear value is
 * this entry, whether it is copied out whole or summed into a box.
 */
export function bt709Table(): Float32Array {
  if (!bt709) {
    bt709 = new Float32Array(65536);
    for (let i = 0; i < 65536; i += 1) bt709[i] = bt709ToLinear(i / 65535);
  }
  return bt709;
}
// The four tables that depend on nothing but the maths are built ONCE per
// page and shared: each is 64–256 KB and a few milliseconds of `pow`, and a
// decode that rebuilt them paid that on every picture. Read-only by contract.
let bt709: Float32Array | null = null;
let srgbEncode: Float32Array | null = null;
let srgbByte: Uint8ClampedArray | null = null;
let halfOfCode: Uint16Array | null = null;

/**
 * LibRaw's 16-bit output → linear light, whole. Through the table, since a
 * 48-megapixel decode is 144 million codes and a `pow` per code is seconds.
 * A full-size Float32 picture: the decoder no longer builds one, but the
 * spec that pins the fused paths is defined against this.
 */
export function linearFromLibRaw(rgb16: Uint16Array, width: number, height: number, table: Float32Array = bt709Table()): LinearRgb {
  const n = width * height * 3;
  if (rgb16.length < n) throw new Error(`a ${width}×${height} decode needs ${n} samples, got ${rgb16.length}`);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) data[i] = table[rgb16[i]];
  return { width, height, data };
}

/** Share of the frame allowed to clip when the exposure is measured — dcraw's `-W` default. */
export const AUTO_BRIGHT_CLIP = 0.01;
/** The gain is never below 1 (the sensor's white is white) nor above this — 4 stops. */
export const MAX_AUTO_GAIN = 16;

/** The gain that puts `white` at 1: bounded, rounded to three decimals. */
function gainForWhite(white: number): number {
  const gain = Math.min(MAX_AUTO_GAIN, Math.max(1, 1 / white));
  return Math.round(gain * 1000) / 1000;
}

/** The white the brightest `clip` share of `hist` sits above — the bin's UPPER edge. */
function whiteFromHistogram(hist: Uint32Array, bins: number, counted: number, clip: number): number {
  if (!counted) return 1;
  // Walk down from white until `clip` of the pixels are above.
  let above = 0;
  let bin = bins;
  while (bin > 0 && above + hist[bin] <= counted * clip) {
    above += hist[bin];
    bin -= 1;
  }
  // The bin's UPPER edge: a white a hair too bright clips a hair less.
  return Math.min(1, (bin + 1) / bins);
}

const GAIN_BINS = 4096;

/**
 * The gain that puts the brightest `clip` share of the picture at white: the
 * picture's own exposure, measured, as dcraw's auto-bright measures it. Read
 * off the per-pixel maximum channel, over a sample of the frame (every
 * `stride`-th pixel), so a 12-megapixel decode is measured in a few ms.
 * Rounded to three decimals: it is STORED on the develop, and a number that
 * differs in the tenth decimal between two decodes is two documents.
 */
export function autoBrightGain(picture: LinearRgb, clip = AUTO_BRIGHT_CLIP, stride = 4): number {
  const { data, width, height } = picture;
  const pixels = width * height;
  const hist = new Uint32Array(GAIN_BINS + 1);
  let counted = 0;
  for (let p = 0; p < pixels; p += stride) {
    const i = p * 3;
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    const bin = m >= 1 ? GAIN_BINS : Math.max(0, Math.floor(m * GAIN_BINS));
    hist[bin] += 1;
    counted += 1;
  }
  if (!counted) return 1;
  return gainForWhite(whiteFromHistogram(hist, GAIN_BINS, counted, clip));
}

/**
 * The same measurement straight off the 16-bit decode, through the table —
 * the whole-picture path, where no linear picture exists to measure. Equal
 * to `autoBrightGain(linearFromLibRaw(rgb16, …))` sample for sample: the
 * table holds the very float32 the linear picture would.
 */
export function autoBrightGainFromLibRaw(
  rgb16: Uint16Array,
  width: number,
  height: number,
  table: Float32Array,
  clip = AUTO_BRIGHT_CLIP,
  stride = 4,
): number {
  const pixels = width * height;
  const hist = new Uint32Array(GAIN_BINS + 1);
  let counted = 0;
  for (let p = 0; p < pixels; p += stride) {
    const i = p * 3;
    const m = Math.max(table[rgb16[i]], table[rgb16[i + 1]], table[rgb16[i + 2]]);
    const bin = m >= 1 ? GAIN_BINS : Math.max(0, Math.floor(m * GAIN_BINS));
    hist[bin] += 1;
    counted += 1;
  }
  if (!counted) return 1;
  return gainForWhite(whiteFromHistogram(hist, GAIN_BINS, counted, clip));
}

/**
 * The size a decode is brought to for a pixel budget: whole when it fits,
 * else the integer box factor that first fits — a box average of linear light
 * is the right resample for a preview (it is what a smaller sensor would have
 * measured), and an integer factor keeps it exact and cheap.
 */
export function rawBoxFactor(width: number, height: number, budgetPixels: number): number {
  if (!(budgetPixels > 0)) return 1;
  let factor = 1;
  while ((width / factor) * (height / factor) > budgetPixels) factor += 1;
  return factor;
}

/** A box average of linear light by an integer factor; the edge rows and columns that do not fill a box are dropped. */
export function boxDownscale(picture: LinearRgb, factor: number): LinearRgb {
  if (factor <= 1) return picture;
  const w = Math.floor(picture.width / factor);
  const h = Math.floor(picture.height / factor);
  const out = new Float32Array(w * h * 3);
  const src = picture.data;
  const sw = picture.width;
  const inv = 1 / (factor * factor);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        let i = ((y * factor + dy) * sw + x * factor) * 3;
        for (let dx = 0; dx < factor; dx += 1) {
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          i += 3;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r * inv;
      out[o + 1] = g * inv;
      out[o + 2] = b * inv;
    }
  }
  return { width: w, height: h, data: out };
}

/** The size `boxLinearRows` writes for a decode of `width`×`height` at `factor`. */
export function boxedSize(width: number, height: number, factor: number): { width: number; height: number } {
  return { width: Math.floor(width / factor), height: Math.floor(height / factor) };
}

/**
 * Rows `[y0, y1)` of the box-averaged linear picture, written into `out`
 * (sized by `boxedSize`) straight from the 16-bit codes through `table` —
 * the fused twin of `boxDownscale(linearFromLibRaw(…))`, summing the same
 * float32 values in the same order, so the two agree to the bit. A band at a
 * time is what lets the decoder yield between rows and stop on a cancel with
 * nothing full-size ever allocated.
 */
export function boxLinearRows(
  rgb16: Uint16Array,
  srcWidth: number,
  factor: number,
  table: Float32Array,
  out: Float32Array,
  outWidth: number,
  y0: number,
  y1: number,
): void {
  const inv = 1 / (factor * factor);
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        let i = ((y * factor + dy) * srcWidth + x * factor) * 3;
        for (let dx = 0; dx < factor; dx += 1) {
          r += table[rgb16[i]];
          g += table[rgb16[i + 1]];
          b += table[rgb16[i + 2]];
          i += 3;
        }
      }
      const o = (y * outWidth + x) * 3;
      out[o] = r * inv;
      out[o + 1] = g * inv;
      out[o + 2] = b * inv;
    }
  }
}

const ENCODE_STEPS = 4096;

/**
 * The sRGB encode over the 0..1 range at 12 bits, exact enough (the
 * half-float itself holds ~11 bits) and 30× faster than the curve per sample.
 */
function srgbEncodeTable(): Float32Array {
  if (!srgbEncode) {
    srgbEncode = new Float32Array(ENCODE_STEPS + 1);
    for (let i = 0; i <= ENCODE_STEPS; i += 1) srgbEncode[i] = fromLinear(i / ENCODE_STEPS, 'srgb');
  }
  return srgbEncode;
}

/** ONE linear sample sRGB-encoded as the GPU picture has it: the table inside 0..1, the exact curve past white. */
function encodeLinearSample(v: number, table: Float32Array): number {
  if (v <= 0) return 0;
  if (v >= 1) return v === 1 ? 1 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const t = v * ENCODE_STEPS;
  const k = Math.floor(t);
  const f = t - k;
  return table[k] + (table[k + 1] - table[k]) * f;
}

/**
 * Linear light → the GPU's source: sRGB-encoded half-floats, sensor white at
 * 1.0 — no gain applied here, the develop stage applies it, so one texture
 * serves every setting of the sliders. Above 1 (a decoder that did not clip)
 * the encode continues past white; the develop stage's headroom rule reads it.
 * Each sample is encoded and packed in one step: no encoded Float32 picture
 * sits between the two.
 */
export function halfImageFromLinear(picture: LinearRgb): HalfImage {
  const out = new Uint16Array(picture.data.length);
  encodeLinearRows(picture, 1, out, null, 0, picture.width * picture.height);
  return { kind: 'half', width: picture.width, height: picture.height, data: out };
}

/**
 * Pixels `[p0, p1)` of a linear picture, encoded in ONE pass into what the
 * stage takes: the half-floats (always) and, where `bytes` is given, the
 * as-shot RGBA at `gain`. One read of each sample serves both, and a band
 * at a time is what lets the decoder yield between two. `halfImageFromLinear`
 * and `bytesFromLinear` are this over the whole picture, one output each —
 * so the three can never disagree about a sample.
 */
export function encodeLinearRows(
  picture: LinearRgb,
  gain: number,
  half: Uint16Array,
  bytes: Uint8ClampedArray | null,
  p0: number,
  p1: number,
): void {
  const { data } = picture;
  const encode = srgbEncodeTable();
  const byteOf = bytes ? srgbByteTable() : null;
  for (let p = p0, i = p0 * 3, o = p0 * 4; p < p1; p += 1, i += 3, o += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    half[i] = toHalf(encodeLinearSample(r, encode));
    half[i + 1] = toHalf(encodeLinearSample(g, encode));
    half[i + 2] = toHalf(encodeLinearSample(b, encode));
    if (bytes && byteOf) {
      bytes[o] = byteOf[byteStep(r, gain)];
      bytes[o + 1] = byteOf[byteStep(g, gain)];
      bytes[o + 2] = byteOf[byteStep(b, gain)];
      bytes[o + 3] = 255;
    }
  }
}

/**
 * Every 16-bit code's half-float — what `halfImageFromLinear` would make of
 * `linearFromLibRaw`'s value for it — so a whole decode is packed by one
 * lookup per sample and no float picture is ever built. 128 KB.
 */
export function halfTableFromLibRaw(table: Float32Array): Uint16Array {
  if (table === bt709 && halfOfCode) return halfOfCode;
  const encode = srgbEncodeTable();
  const out = new Uint16Array(65536);
  for (let i = 0; i < 65536; i += 1) out[i] = toHalf(encodeLinearSample(table[i], encode));
  if (table === bt709) halfOfCode = out;
  return out;
}

/** Samples `[from, to)` of a whole decode, packed through `halfTable` into `out`. */
export function packHalfSamples(rgb16: Uint16Array, halfTable: Uint16Array, out: Uint16Array, from: number, to: number): void {
  for (let i = from; i < to; i += 1) out[i] = halfTable[rgb16[i]];
}

/** The 8-bit picture of the decode AS SHOT — with its measured gain, clipped at white — for a 2D canvas. */
export function bytesFromLinear(picture: LinearRgb, gain: number): Uint8ClampedArray<ArrayBuffer> {
  const { data, width, height } = picture;
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const table = srgbByteTable();
  for (let p = 0, i = 0, o = 0; p < width * height; p += 1, i += 3, o += 4) {
    out[o] = table[byteStep(data[i], gain)];
    out[o + 1] = table[byteStep(data[i + 1], gain)];
    out[o + 2] = table[byteStep(data[i + 2], gain)];
    out[o + 3] = 255;
  }
  return out;
}

function srgbByteTable(): Uint8ClampedArray {
  if (!srgbByte) {
    srgbByte = new Uint8ClampedArray(ENCODE_STEPS + 1);
    for (let i = 0; i <= ENCODE_STEPS; i += 1) srgbByte[i] = Math.round(fromLinear(i / ENCODE_STEPS, 'srgb') * 255);
  }
  return srgbByte;
}

function byteStep(linear: number, gain: number): number {
  return Math.min(ENCODE_STEPS, Math.max(0, Math.round(linear * gain * ENCODE_STEPS)));
}

/**
 * Every 16-bit code's as-shot byte at `gain` — `bytesFromLinear`'s value for
 * `linearFromLibRaw`'s value for it — for the whole-decode path. 64 KB.
 */
export function byteTableFromLibRaw(table: Float32Array, gain: number): Uint8ClampedArray {
  const bytes = srgbByteTable();
  const out = new Uint8ClampedArray(65536);
  for (let i = 0; i < 65536; i += 1) out[i] = bytes[byteStep(table[i], gain)];
  return out;
}

/** Pixels `[from, to)` of a whole decode as RGBA bytes through `byteTable`, into `out`. */
export function packBytePixels(rgb16: Uint16Array, byteTable: Uint8ClampedArray, out: Uint8ClampedArray, from: number, to: number): void {
  for (let p = from, i = from * 3, o = from * 4; p < to; p += 1, i += 3, o += 4) {
    out[o] = byteTable[rgb16[i]];
    out[o + 1] = byteTable[rgb16[i + 1]];
    out[o + 2] = byteTable[rgb16[i + 2]];
    out[o + 3] = 255;
  }
}
