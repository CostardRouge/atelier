/**
 * PRESENCE — texture, clarity and dehaze (audit item 13,
 * `docs/lightroom-gaps.md`): Lightroom's three sliders that change how a
 * picture READS without changing its tones one by one. None of them can ride
 * the cube — each asks what is AROUND a pixel — so they are passes like the
 * detail ones (`detail.ts`), with this module as their pure twin.
 *
 * All three are the same machine at three scales: a wide, smooth estimate of
 * something (a luma, or a haze) and the pixel moved against it.
 *
 * - **Dehaze** reads the haze as the DARK CHANNEL — the smallest of R, G and
 *   B in LINEAR light, blurred wide (a clear pixel has one dark channel, haze
 *   lifts all three) — and inverts the veil `I = J·t + A·(1 − t)`, in linear
 *   light, with a white airlight and a floor on `t`. Negative ADDS a veil. It
 *   darkens a bright sky, as Lightroom's does: that is what haze removal is.
 *   Measured on the encoded values instead, a clear dark field read as a
 *   veil and went from 80 to 43 at +80.
 * - **Clarity** is local contrast at a LARGE scale, weighted to the midtones
 *   (a bell on luma), so shapes and clouds gain body and the ends are spared.
 * - **Texture** is the same at a SMALL scale, unweighted: skin pores, bark,
 *   fabric — finer than clarity, coarser than a sharpen. Negative smooths.
 *
 * Clarity and texture move the LUMA and carry RGB as one ratio
 * (`scaleToLuma`), so no hue rotates; the move is soft-limited, which is what
 * keeps a strong edge from wearing a halo.
 *
 * **Scales are FRACTIONS of the picture's short side**, never pixels: the
 * stage, the loupe and a 60-megapixel export then blur the same part of the
 * scene, and a preview is the export shrunk rather than a different filter.
 * A wide Gaussian is walked in at most `PRESENCE_TAPS` steps a side, spaced
 * past one pixel and read BILINEARLY — the GPU's own filtering, mirrored by
 * `sampleBilinear` — which is what keeps a 100-pixel blur to a bounded loop.
 *
 * **Order**: after every warp and layer, before the sharpen (`detail-pass.ts`,
 * `detailPasses`): dehaze, clarity, texture.
 *
 * Pure and DOM-free; the shaders are `presence-pass.ts`.
 */

import { fromLinear, toLinear } from '../lut/transfer';
import { lumaOf, scaleToLuma, type DetailImage } from './detail';

/** The furthest tap a side a presence blur walks — a GLSL loop needs a constant bound. */
export const PRESENCE_TAPS = 24;

/** Each blur's sigma as a share of the picture's short side. */
export const PRESENCE_SCALE = {
  dehaze: 0.03,
  clarity: 0.012,
  texture: 0.002,
} as const;

export type PresenceOp = keyof typeof PRESENCE_SCALE;

/** What a blur estimates: the luma (clarity, texture) or the dark channel (dehaze). */
export type PresenceSignal = 'luma' | 'dark';

/** How much a full slider does. */
export const DEHAZE_STRENGTH = 0.8;
/** The transmission never falls under this, or a white sky would go black. */
export const DEHAZE_FLOOR = 0.2;
/** A veil added at −100. */
export const HAZE_ADDED = 0.6;
/** Clarity and texture at +100 add 1.5× the local detail; at −100 take 1× of it away. */
export const CONTRAST_GAIN = { up: 1.5, down: 1 } as const;

/** The blur a scale asks for on a picture of this size: its sigma, the spacing of its taps, and how many a side. */
export function blurGeometry(frac: number, width: number, height: number): { sigma: number; step: number; taps: number } {
  const sigma = Math.max(0.8, frac * Math.min(width, height));
  const step = Math.max(1, (3 * sigma) / PRESENCE_TAPS);
  const taps = Math.min(PRESENCE_TAPS, Math.ceil((3 * sigma) / step));
  return { sigma, step, taps };
}

/** A pixel read between pixel centres, clamped at the edges — `texture()` with LINEAR and CLAMP_TO_EDGE. */
export function sampleBilinear(img: DetailImage, x: number, y: number): [number, number, number] {
  const cx = x < 0 ? 0 : x > img.width - 1 ? img.width - 1 : x;
  const cy = y < 0 ? 0 : y > img.height - 1 ? img.height - 1 : y;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const at = (px: number, py: number, c: number) => img.data[(py * img.width + px) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const top = at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx;
    const bottom = at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

function planeBilinear(plane: Float32Array, width: number, height: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > width - 1 ? width - 1 : x;
  const cy = y < 0 ? 0 : y > height - 1 ? height - 1 : y;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = plane[y0 * width + x0] * (1 - fx) + plane[y0 * width + x1] * fx;
  const bottom = plane[y1 * width + x0] * (1 - fx) + plane[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function signalOf(signal: PresenceSignal, r: number, g: number, b: number): number {
  if (signal === 'luma') return lumaOf(r, g, b);
  // The dark channel in LINEAR light: haze is light ADDED, and in the encoded
  // values a clear midtone's darkest channel already reads as a veil.
  return Math.min(toLinear(r, 'srgb'), toLinear(g, 'srgb'), toLinear(b, 'srgb'));
}

/**
 * The wide estimate, whole — the H pass over the picture (reading the signal
 * of each bilinear sample), then the V pass over that. What the pair of GPU
 * passes computes, the H pass carrying its result in the alpha channel.
 */
export function presenceBlur(img: DetailImage, frac: number, signal: PresenceSignal): Float32Array {
  const { width, height } = img;
  const { sigma, step, taps } = blurGeometry(frac, width, height);
  const weights: number[] = [];
  for (let k = -taps; k <= taps; k++) weights.push(Math.exp(-((k * step) ** 2) / (2 * sigma * sigma)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const h = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -taps; k <= taps; k++) {
        const [r, g, b] = sampleBilinear(img, x + k * step, y);
        acc += weights[k + taps] * signalOf(signal, r, g, b);
      }
      h[y * width + x] = acc / sum;
    }
  }
  const v = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -taps; k <= taps; k++) acc += weights[k + taps] * planeBilinear(h, width, height, x, y + k * step);
      v[y * width + x] = acc / sum;
    }
  }
  return v;
}

/**
 * One ENCODED pixel with the haze taken out (amount > 0) or put in (< 0);
 * `veil` is the blurred dark channel, in linear light. The veil model is
 * inverted in LINEAR light, where it is true — the pixel is decoded, moved
 * and encoded again, so a clear dark field (a darkest channel near 0 in
 * light) is left nearly alone.
 */
export function dehazeAt(r: number, g: number, b: number, veil: number, amount: number): [number, number, number] {
  const t =
    amount > 0 ? Math.max(DEHAZE_FLOOR, 1 - DEHAZE_STRENGTH * amount * veil) : 1 + HAZE_ADDED * amount;
  const f =
    amount > 0
      ? (c: number) => fromLinear(Math.max(0, (toLinear(c, 'srgb') - 1) / t + 1), 'srgb')
      : (c: number) => fromLinear(toLinear(c, 'srgb') * t + (1 - t), 'srgb');
  return [f(r), f(g), f(b)];
}

/**
 * How hard a large difference is limited: texture lives in small differences
 * (a few hundredths), a halo in the large ones at a hard edge. At 4 a block
 * against a sky wore a visible glow at clarity +100; at 10 a 0.02 detail
 * keeps 83 % of itself and a 0.1 edge half.
 */
export const SOFT_LIMIT = 10;

/** The detail a local-contrast move is made of, soft-limited so a hard edge cannot ring. */
export function softDetail(d: number): number {
  return d / (1 + SOFT_LIMIT * Math.abs(d));
}

/**
 * One pixel's luma moved against its blurred surroundings — clarity (the
 * midtones only, `midtones`) or texture — and RGB carried as one ratio.
 */
export function localContrastAt(
  r: number,
  g: number,
  b: number,
  blurred: number,
  amount: number,
  midtones: boolean,
): [number, number, number] {
  const Y = lumaOf(r, g, b);
  const gain = amount * (amount > 0 ? CONTRAST_GAIN.up : CONTRAST_GAIN.down);
  const bell = midtones ? Math.max(0, Math.min(1, 4 * Y * (1 - Y))) : 1;
  const out = Math.max(0, Y + gain * softDetail(Y - blurred) * bell);
  return scaleToLuma(r, g, b, Y, out);
}

/** The three sliders as amounts −1..1; 0 means no pass. */
export interface PresenceAmounts {
  dehaze: number;
  clarity: number;
  texture: number;
}

/** The whole chain on a picture — dehaze, clarity, texture — for a spec and the render gate. */
export function applyPresence(img: DetailImage, amounts: PresenceAmounts): DetailImage {
  let cur = img;
  const step = (op: PresenceOp, signal: PresenceSignal, pixel: (rgb: [number, number, number], blurred: number) => [number, number, number]) => {
    const blurred = presenceBlur(cur, PRESENCE_SCALE[op], signal);
    const out = new Float32Array(cur.data.length);
    for (let i = 0; i < cur.width * cur.height; i++) {
      const px = pixel([cur.data[i * 3], cur.data[i * 3 + 1], cur.data[i * 3 + 2]], blurred[i]);
      out[i * 3] = px[0];
      out[i * 3 + 1] = px[1];
      out[i * 3 + 2] = px[2];
    }
    cur = { width: cur.width, height: cur.height, data: out };
  };
  if (amounts.dehaze) step('dehaze', 'dark', ([r, g, b], v) => dehazeAt(r, g, b, v, amounts.dehaze));
  if (amounts.clarity) step('clarity', 'luma', ([r, g, b], v) => localContrastAt(r, g, b, v, amounts.clarity, true));
  if (amounts.texture) step('texture', 'luma', ([r, g, b], v) => localContrastAt(r, g, b, v, amounts.texture, false));
  return cur;
}
