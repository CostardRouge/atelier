/**
 * The POST-CROP VIGNETTE (audit item 21, `docs/lightroom-gaps.md`) —
 * Lightroom's Effects vignette: a darkening (or a lightening) toward the
 * edges of the picture AS DELIVERED, so it follows the crop, where the lens
 * correction's vignetting (`lens.ts`) follows the optics of the whole frame.
 *
 * The crop is drawn AFTER the graph (`drawDelivered`), so this pass cannot
 * just use its own texture coordinates: it is handed an AFFINE map from the
 * picture's image coordinates to the delivered frame's (`FrameAffine`, made
 * from the very framing `framePoint` draws with), and shapes the vignette in
 * the frame. A picture never cropped gets the identity.
 *
 * Lightroom's five controls:
 *
 * - **Amount** −100..100: dark below zero, light above.
 * - **Midpoint** 0..100: how far in the falloff begins.
 * - **Roundness** −100..100: 0 an ellipse fitted to the frame, +100 a circle,
 *   −100 toward a rounded rectangle (a superellipse).
 * - **Feather** 0..100: how soft the falloff is.
 * - **Highlights** 0..100: how much a bright pixel is spared a dark vignette —
 *   a sky at the corner keeps its light.
 *
 * The move is made in LINEAR light, like every gain in the graph.
 *
 * Pure and DOM-free; the shader is `post-vignette-pass.ts`.
 */

import { fromLinear, toLinear } from '../lut/transfer';

export interface PostCropVignette {
  amount: number;
  midpoint: number;
  roundness: number;
  feather: number;
  highlights: number;
}

export const DEFAULT_POST_VIGNETTE: Readonly<PostCropVignette> = Object.freeze({
  amount: 0,
  midpoint: 50,
  roundness: 0,
  feather: 50,
  highlights: 0,
});

export const POST_VIGNETTE_RANGES: Readonly<Record<keyof PostCropVignette, { min: number; max: number }>> = {
  amount: { min: -100, max: 100 },
  midpoint: { min: 0, max: 100 },
  roundness: { min: -100, max: 100 },
  feather: { min: 0, max: 100 },
  highlights: { min: 0, max: 100 },
};

const KEYS = Object.keys(DEFAULT_POST_VIGNETTE) as (keyof PostCropVignette)[];

/** Only Amount does anything: the other four shape a vignette that is not there. */
export function isDefaultPostVignette(v: PostCropVignette | null | undefined): boolean {
  return !v || v.amount === 0;
}

export function samePostVignette(a: PostCropVignette | null | undefined, b: PostCropVignette | null | undefined): boolean {
  if (isDefaultPostVignette(a) || isDefaultPostVignette(b)) return isDefaultPostVignette(a) && isDefaultPostVignette(b);
  return KEYS.every((k) => a![k] === b![k]);
}

/** A stored vignette read back safely — each number clamped, a missing one its default — or null for none. */
export function postVignetteOrNull(raw: unknown): PostCropVignette | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out = { ...DEFAULT_POST_VIGNETTE };
  for (const k of KEYS) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(POST_VIGNETTE_RANGES[k].min, Math.min(POST_VIGNETTE_RANGES[k].max, v));
  }
  return isDefaultPostVignette(out) ? null : out;
}

/** `vignette −40` · `vignette −40, round +100` — Amount and what departs from the defaults. */
export function describePostVignette(v: PostCropVignette | null | undefined): string {
  if (isDefaultPostVignette(v)) return '';
  const s = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  const extra = [
    v!.midpoint !== DEFAULT_POST_VIGNETTE.midpoint ? `mid ${v!.midpoint}` : '',
    v!.roundness ? `round ${s(v!.roundness)}` : '',
    v!.feather !== DEFAULT_POST_VIGNETTE.feather ? `feather ${v!.feather}` : '',
    v!.highlights ? `highlights ${v!.highlights}` : '',
  ].filter(Boolean);
  return `vignette ${s(v!.amount)}${extra.length ? `, ${extra.join(', ')}` : ''}`;
}

/** The numbers the shader takes — ONE place, read by the GLSL and the maths alike. */
export interface PostVignetteTerms {
  /** −1..1. */
  amount: number;
  /** Where the falloff begins, in the frame's shape distance (1 at an edge's middle). */
  start: number;
  /** How wide the falloff is, in the same units. */
  width: number;
  /** −1..1. */
  roundness: number;
  /** 0..1. */
  highlights: number;
}

export function postVignetteTerms(v: PostCropVignette): PostVignetteTerms {
  return {
    amount: v.amount / 100,
    start: 0.25 + (v.midpoint / 100) * 0.9,
    width: 0.02 + (v.feather / 100) * 1.0,
    roundness: v.roundness / 100,
    highlights: v.highlights / 100,
  };
}

/**
 * Image coordinates → the delivered frame's, both in [0,1], y down:
 * `u = a·x + b·y + c`, `v = d·x + e·y + f`. The identity is a picture never
 * cropped.
 */
export type FrameAffine = readonly [number, number, number, number, number, number];
export const IDENTITY_FRAME: FrameAffine = [1, 0, 0, 0, 1, 0];

export function toFrame(affine: FrameAffine, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = affine;
  return [a * x + b * y + c, d * x + e * y + f];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How far a frame point is from the centre, in the vignette's own shape: 1
 * at the middle of an edge, more toward a corner. Roundness blends toward a
 * circle (the frame's short side squeezed to the long one's scale) or raises
 * the norm toward a rounded rectangle.
 */
export function shapeDistance(u: number, v: number, frameAspect: number, roundness: number): number {
  let x = (u - 0.5) * 2;
  let y = (v - 0.5) * 2;
  if (roundness > 0) {
    const qx = frameAspect >= 1 ? x : x * frameAspect;
    const qy = frameAspect >= 1 ? y / frameAspect : y;
    x += (qx - x) * roundness;
    y += (qy - y) * roundness;
  }
  const n = roundness < 0 ? 2 + 8 * -roundness : 2;
  return Math.pow(Math.pow(Math.abs(x), n) + Math.pow(Math.abs(y), n), 1 / n);
}

/** One ENCODED pixel at frame point (u, v) through the vignette. */
export function postVignetteAt(
  r: number,
  g: number,
  b: number,
  u: number,
  v: number,
  frameAspect: number,
  terms: PostVignetteTerms,
): [number, number, number] {
  const t = smoothstep(terms.start, terms.start + terms.width, shapeDistance(u, v, frameAspect, terms.roundness));
  if (!t || !terms.amount) return [r, g, b];
  const lin = [toLinear(r, 'srgb'), toLinear(g, 'srgb'), toLinear(b, 'srgb')];
  let out: number[];
  if (terms.amount < 0) {
    // A bright pixel is spared a dark vignette by Highlights.
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const spare = 1 - terms.highlights * smoothstep(0.5, 1, y);
    const k = 1 + terms.amount * t * spare;
    out = lin.map((c) => c * k);
  } else {
    out = lin.map((c) => c + (1 - c) * terms.amount * t);
  }
  return [fromLinear(out[0], 'srgb'), fromLinear(out[1], 'srgb'), fromLinear(out[2], 'srgb')];
}
