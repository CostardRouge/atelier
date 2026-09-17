/**
 * The grain's noise field: a tile of independent white noise, and where in
 * it a frame looks.
 *
 * WHY WHITE NOISE IN A TILE, sampled LINEAR at one texel per grain cell: the
 * bilinear read IS the band-limiting filter, so the grain has a controllable
 * period and survives the downscale every consumer performs after the grader
 * (a 48 MP still delivered at 1080 px is box-filtered 5.5×; a per-fragment
 * hash at one source pixel loses its variance in that filter and arrives as
 * grey haze). Four channels: a luma field and three per-channel fields the
 * shader mixes by `grainChroma`.
 *
 * WHY A PHASE AND NOT A TRANSLATION: an offset of more than a couple of cells
 * into white noise decorrelates completely, so each frame gets a genuinely
 * new field rather than the last one slid along — which is what makes grain
 * live instead of crawl. The phase is pure in (frameIndex, seed), so a
 * re-export is byte-identical, and it steps on the SOURCE frame quantised to
 * `grainFps`: real film re-rolls its grain once per photographed frame, and
 * re-rolling at 60 Hz on 24 fps material is the "boiling". Pure and DOM-free.
 */

import { mulberry32 } from '../lib/prng';
import { NOISE_SIZE } from './film-texture';

/**
 * RGBA bytes of a tiling noise tile, `size × size × 4`, every channel an
 * independent uniform draw. Deterministic per seed.
 */
export function makeGrainNoise(seed: number, size = NOISE_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const r = mulberry32(seed);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.floor(r() * 256);
  return out;
}

// Two irrational strides, one per axis: consecutive frames land far apart in
// the tile and the sequence never closes on itself within a clip's length.
const STRIDE_X = 0.6180339887498949; // φ − 1
const STRIDE_Y = 0.41421356237309503; // √2 − 1

/** The tile offset a frame samples at, in texture units [0, 1)². */
export function grainPhase(frameIndex: number, seed: number): [number, number] {
  const r = mulberry32(seed);
  const ox = r();
  const oy = r();
  const i = Math.max(0, Math.floor(frameIndex));
  const frac = (v: number) => v - Math.floor(v);
  return [frac(ox + STRIDE_X * i), frac(oy + STRIDE_Y * i)];
}

/** Which grain field a source instant sees: `floor(t · fps)`, and always 0 when the grain is frozen. */
export function grainFrameIndex(sourceSeconds: number, grainFps: number): number {
  if (grainFps <= 0 || !Number.isFinite(sourceSeconds)) return 0;
  return Math.max(0, Math.floor(sourceSeconds * grainFps));
}
