/**
 * Dither the one place the render still drops to 8 bits: the canvas.
 *
 * The chain runs in float16 (`render-core.md`) and a RAW arrives as
 * half-floats (`half-image.ts`), so the value a pass writes for a pixel of a
 * smooth sky is, say, 100.37 codes — and the canvas rounds it to 100. Rounded
 * that way, a gentle gradient comes out as flat steps a whole code apart:
 * the bands a pushed sky shows, which no amount of precision upstream cures,
 * because the last rounding throws it away. Adding a little noise BEFORE the
 * rounding turns each step into a scatter whose average IS 100.37 — what
 * Lightroom and Capture One do at their own 8-bit exports.
 *
 * Three rules, each for a reason:
 *
 * - **Only where more than 8 bits reached the canvas**: a half-float source,
 *   or a chain of two passes or more over float16 targets (`wantsDither`).
 *   One pass over an 8-bit source is the old renderer, pixel for pixel
 *   (`render-core.md`, «At one pass it IS the old renderer»), and its steps
 *   are the SOURCE's, which no dither at the output can fill.
 * - **An exact code stays exact.** The noise is uniform and strictly inside
 *   ±0.5 of a code — ±`DITHER_LSB` — so a value already on a code (an
 *   untouched pixel of an 8-bit source, a clipping mark) rounds back to
 *   itself. The margin is float16's: a code stored in a half-float target is
 *   off by at most 1/16 of a code at the top of the range, and 7/16 + 1/16
 *   still rounds home. The price is that a fraction within 1/16 of a code is
 *   never moved; the bands it would make are 1/8 of the width they were.
 * - **The noise is a function of the pixel, never of time**: a still repaints
 *   identically, a banded frame (`band-plan.ts`) gets the whole frame's
 *   noise, and a clip carries a fixed pattern well under one code rather than
 *   a shimmer.
 * - **One value for the three channels, drawn per 2 × 2 block**, because the
 *   file is a JPEG. It codes brightness and colour apart and quantises colour
 *   much harder, so noise drawn per channel is mostly colour and is erased;
 *   and its quantisation removes the finest detail first, so noise per pixel
 *   is erased at the qualities a delivery uses. Measured on an 8-code ramp
 *   (`scripts/check-render.mjs`), the error of a column's average against the
 *   ramp: 0.50 code undithered; per pixel and per channel 0.12 on the canvas
 *   but 0.42 after a JPEG at 0.92; this pattern 0.15 on the canvas and 0.22
 *   after the JPEG. On a photograph it costs nothing in bytes (±0.2 % at
 *   0.85–0.95).
 *
 * Pure and DOM-free; the GLSL is a rewrite of a pass's fragment, so no pass
 * has to know it may be the last one.
 */

import type { RenderPrecision } from './graph';

/** The noise's half-width, in 8-bit codes — under 0.5 by float16's margin, see above. */
export const DITHER_LSB = 0.4375;

/** Whether the value reaching the canvas carries more than 8 bits, so that rounding it bands. */
export function wantsDither(chain: {
  precision: RenderPrecision;
  /** The source is a `HalfImage` (a RAW). */
  halfSource: boolean;
  /** How many passes the chain draws. */
  passes: number;
}): boolean {
  if (chain.halfSource) return true;
  return chain.precision === 'float16' && chain.passes >= 2;
}

/**
 * Whether this DEVICE dithers at all (2026-10-06, the maintainer: «est-ce qu'on
 * a bien pensé à ce qu'on puisse le désactiver ?»): `auto` follows the rule
 * above, `off` never dithers — the canvas then rounds exactly as it did before
 * 2026-10-05. A browser preference like the band policy, set in Develop's
 * settings page, never a document's.
 */
export type DitherPreference = 'auto' | 'off';

export const DITHER_PREFERENCE_KEY = 'atelier.render.dither';

/** A stored value read back — anything but `off` is `auto`, the rule as built. */
export function readDitherPreference(stored: string | null | undefined): DitherPreference {
  return stored === 'off' ? 'off' : 'auto';
}

const MAIN = /\bvoid\s+main\s*\(\s*(?:void\s*)?\)/g;

/**
 * The GLSL that adds the noise, appended after the pass's own code. `u_dither`
 * is the half-width in codes; 0 (a uniform's default) adds nothing at all, so
 * a pass drawn into a target, or into a canvas that wants no dither, writes
 * exactly what it always wrote.
 *
 * The hash is PCG (Jarzynski & Olano, "Hash Functions for GPU Rendering"), on
 * `highp` integers: a `fract(sin(…))` hash loses its bits at the coordinates
 * of a 48-megapixel frame on some GPUs and draws a pattern.
 */
const DITHER_GLSL = `
precision highp int;
uniform float u_dither;
highp uint _ditherPcg(highp uint v) {
  highp uint state = v * 747796405u + 2891336453u;
  highp uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float _ditherNoise(highp uvec2 pixel) {
  highp uvec2 p = pixel >> 1u;
  highp uint h = _ditherPcg(p.x ^ _ditherPcg(p.y));
  return float(h >> 8u) / 16777216.0 - 0.5;
}
void main() {
  _undithered();
  if (u_dither > 0.0) {
    outColor.rgb += _ditherNoise(uvec2(gl_FragCoord.xy)) * (2.0 * u_dither / 255.0);
  }
}
`;

/**
 * The fragment with its `main` renamed and a dithering `main` around it, or
 * null where the shader cannot be read that way (no `main`, or two) — that
 * pass is then simply never dithered.
 */
export function ditherFragment(fragment: string): string | null {
  const found = fragment.match(MAIN);
  if (!found || found.length !== 1) return null;
  if (!/\bout\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\s+outColor\b/.test(fragment)) return null;
  return fragment.replace(MAIN, 'void _undithered()') + DITHER_GLSL;
}

const pcg = (v: number): number => {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
};

/**
 * The shader's noise for pixel (x, y) — the same for its three channels and
 * its 2 × 2 block — in [-0.5, 0.5): the twin a spec and the render gate hold
 * the GLSL to. `y` counts from the BOTTOM row, as `gl_FragCoord` does.
 */
export function ditherNoise(x: number, y: number): number {
  const h = pcg((x >>> 1) ^ pcg(y >>> 1));
  return (h >>> 8) / 16777216 - 0.5;
}
