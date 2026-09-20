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
import type { GrainSample } from './film-grain';
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

/**
 * One bilinear, REPEAT-wrapped read of the tile — the CPU TWIN of the node's
 * `texture(u_noise, uv)`, and therefore the definition of what the shader is
 * held to by `scripts/check-render.mjs`.
 *
 * The bilinear read is not an implementation detail here, it IS the
 * band-limiting filter (see the header): a nearest read would put white noise
 * back at one texel and lose it in the first downscale. Texel centres sit at
 * `(i + 0.5) / size`, which is why the half-texel comes off before the floor.
 */
export function sampleGrainTile(
  bytes: ArrayLike<number>,
  u: number,
  v: number,
  size = NOISE_SIZE,
): GrainSample {
  const x = u * size - 0.5;
  const y = v * size - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const wrap = (i: number) => ((i % size) + size) % size;
  const xs = [wrap(x0), wrap(x0 + 1)];
  const ys = [wrap(y0), wrap(y0 + 1)];
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c += 1) {
    const at = (ix: number, iy: number) => bytes[(iy * size + ix) * 4 + c] / 255;
    const top = at(xs[0], ys[0]) * (1 - fx) + at(xs[1], ys[0]) * fx;
    const bottom = at(xs[0], ys[1]) * (1 - fx) + at(xs[1], ys[1]) * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  // The same channel order `grainSampleFrom` reads: alpha is the luma field.
  return [out[3] - 0.5, out[0] - 0.5, out[1] - 0.5, out[2] - 0.5];
}
