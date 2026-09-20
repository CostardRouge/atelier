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
 * Pure and DOM-free; every function here is exercised by a spec.
 */

import { fromLinear } from '../lut/transfer';
import { packHalfImage, type HalfImage } from '../render/half-image';

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
 * LibRaw's 16-bit output → linear light. Through a 65536-entry table, since
 * a 48-megapixel decode is 144 million codes and a `pow` per code is seconds.
 */
export function linearFromLibRaw(rgb16: Uint16Array, width: number, height: number): LinearRgb {
  const n = width * height * 3;
  if (rgb16.length < n) throw new Error(`a ${width}×${height} decode needs ${n} samples, got ${rgb16.length}`);
  const table = new Float32Array(65536);
  for (let i = 0; i < 65536; i += 1) table[i] = bt709ToLinear(i / 65535);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) data[i] = table[rgb16[i]];
  return { width, height, data };
}

/** Share of the frame allowed to clip when the exposure is measured — dcraw's `-W` default. */
export const AUTO_BRIGHT_CLIP = 0.01;
/** The gain is never below 1 (the sensor's white is white) nor above this — 4 stops. */
export const MAX_AUTO_GAIN = 16;

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
  const bins = 4096;
  const hist = new Uint32Array(bins + 1);
  let counted = 0;
  for (let p = 0; p < pixels; p += stride) {
    const i = p * 3;
    const m = Math.max(data[i], data[i + 1], data[i + 2]);
    const bin = m >= 1 ? bins : Math.max(0, Math.floor(m * bins));
    hist[bin] += 1;
    counted += 1;
  }
  if (!counted) return 1;
  // Walk down from white until `clip` of the pixels are above.
  let above = 0;
  let bin = bins;
  while (bin > 0 && above + hist[bin] <= counted * clip) {
    above += hist[bin];
    bin -= 1;
  }
  // The bin's UPPER edge: a white a hair too bright clips a hair less.
  const white = Math.min(1, (bin + 1) / bins);
  const gain = Math.min(MAX_AUTO_GAIN, Math.max(1, 1 / white));
  return Math.round(gain * 1000) / 1000;
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

/**
 * Linear light → the GPU's source: sRGB-encoded half-floats, sensor white at
 * 1.0 — no gain applied here, the develop stage applies it, so one texture
 * serves every setting of the sliders. Above 1 (a decoder that did not clip)
 * the encode continues past white; the develop stage's headroom rule reads it.
 */
export function halfImageFromLinear(picture: LinearRgb): HalfImage {
  const { data } = picture;
  const encoded = new Float32Array(data.length);
  // A table over the 0..1 range at 12 bits, exact enough (the half-float
  // itself holds ~11 bits) and 30× faster than the curve per sample; values
  // past 1 take the slow, exact path.
  const steps = 4096;
  const table = new Float32Array(steps + 1);
  for (let i = 0; i <= steps; i += 1) table[i] = fromLinear(i / steps, 'srgb');
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    if (v <= 0) encoded[i] = 0;
    else if (v >= 1) encoded[i] = v === 1 ? 1 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    else {
      const t = v * steps;
      const k = Math.floor(t);
      const f = t - k;
      encoded[i] = table[k] + (table[k + 1] - table[k]) * f;
    }
  }
  return packHalfImage(encoded, picture.width, picture.height);
}

/** The 8-bit picture of the decode AS SHOT — with its measured gain, clipped at white — for a 2D canvas. */
export function bytesFromLinear(picture: LinearRgb, gain: number): Uint8ClampedArray<ArrayBuffer> {
  const { data, width, height } = picture;
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const steps = 4096;
  const table = new Uint8ClampedArray(steps + 1);
  for (let i = 0; i <= steps; i += 1) table[i] = Math.round(fromLinear(i / steps, 'srgb') * 255);
  for (let p = 0, i = 0, o = 0; p < width * height; p += 1, i += 3, o += 4) {
    out[o] = table[Math.min(steps, Math.max(0, Math.round(data[i] * gain * steps)))];
    out[o + 1] = table[Math.min(steps, Math.max(0, Math.round(data[i + 1] * gain * steps)))];
    out[o + 2] = table[Math.min(steps, Math.max(0, Math.round(data[i + 2] * gain * steps)))];
    out[o + 3] = 255;
  }
  return out;
}
