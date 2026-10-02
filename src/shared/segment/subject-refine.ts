/**
 * REFINING what the subject model found (2026-10-02, `docs/mask-ui-redesign.md`
 * §5.2) — three knobs over the model's answer, never a second model.
 *
 * `magic_touch` answers a point with a CONFIDENCE map: for every pixel, how
 * sure it is that the pixel belongs to the object under the point. Its own
 * category mask is that map cut at one half — measured: 0 pixels of 240 000
 * differ, before and after the map is quantised to a byte — so a subject left
 * at the defaults draws exactly what it drew before the map was asked for.
 *
 * - **Tolerance** moves the cut. Higher takes in pixels the model was less sure
 *   of (the edge band, a neighbour it half-joined); lower keeps only the core.
 * - **Only what touches my + points** drops every island no added point lands
 *   in — the second person far away that a tap on the first also returned.
 * - **Grow / Shrink** moves the edge by a number of pixels, counted at the
 *   model's 1024 px view so a value means the same on every picture.
 *
 * Pure and DOM-free: the stage (`use-subject-masks.ts`) and the export
 * (`subject-rasters.ts`) both go through `composeSubject`, which calls these,
 * so preview = export holds by construction.
 */

import type { BrushRaster } from '../render/brush-raster';

/** How the author refined a subject. Every field is optional; absent = the model's own answer. */
export interface SubjectRefine {
  /** How unsure the model may be and a pixel still count, in (0,1). 0.5 is the model's own cut. */
  tolerance?: number;
  /** Keep only the regions an added point lands in. */
  islands?: boolean;
  /** Pixels at the model's view: positive grows the subject, negative shrinks it. */
  grow?: number;
}

/** The model's own cut — a subject never refined draws what it always drew. */
export const DEFAULT_TOLERANCE = 0.5;
/** Past these the cut takes in everything, or nothing the model is not certain of. */
export const TOLERANCE_MIN = 0.05;
export const TOLERANCE_MAX = 0.95;
/** The farthest Grow / Shrink reaches, in pixels at `GROW_REFERENCE_EDGE`. */
export const GROW_LIMIT = 24;
/**
 * The long edge a Grow / Shrink pixel is counted at — the model's own input
 * (`SEGMENT_INPUT_LONG_EDGE`, which `segmenter.ts` imports this module beside;
 * a test holds the two equal), so a picture smaller than that grows by as
 * much of itself as a big one does.
 */
export const GROW_REFERENCE_EDGE = 1024;

/** A pixel counts as IN where its coverage is at least half. */
const IN = 128;

/** The settings as numbers, defaults filled and every value brought into range. */
export function normaliseRefine(r: SubjectRefine | null | undefined): Required<SubjectRefine> {
  const t = r?.tolerance;
  const g = r?.grow;
  return {
    tolerance: typeof t === 'number' && Number.isFinite(t) ? Math.min(TOLERANCE_MAX, Math.max(TOLERANCE_MIN, t)) : DEFAULT_TOLERANCE,
    islands: r?.islands === true,
    grow: typeof g === 'number' && Number.isFinite(g) ? Math.round(Math.min(GROW_LIMIT, Math.max(-GROW_LIMIT, g))) : 0,
  };
}

/** Whether the settings change nothing the model answered. */
export function isDefaultRefine(r: SubjectRefine | null | undefined): boolean {
  const n = normaliseRefine(r);
  return n.tolerance === DEFAULT_TOLERANCE && !n.islands && n.grow === 0;
}

/**
 * The confidence map CUT at the tolerance: 255 where the model is at least
 * `1 − tolerance` sure, 0 elsewhere. At the default that is the model's own
 * category mask, pixel for pixel. Pure; a fresh raster.
 */
export function cutConfidence(raster: BrushRaster, tolerance = DEFAULT_TOLERANCE): BrushRaster {
  const threshold = (1 - normaliseRefine({ tolerance }).tolerance) * 255;
  const data = new Uint8Array(raster.data.length);
  for (let i = 0; i < data.length; i += 1) data[i] = raster.data[i] > threshold ? 255 : 0;
  return { data, width: raster.width, height: raster.height };
}

/**
 * Only the regions an added point lands in, the rest set to 0 — the islands
 * the model returned with the subject but nowhere near what was tapped. A
 * point that lands just outside the mask (on its very edge, or in a hole)
 * reaches for the nearest covered pixel within `reach` pixels; a point that
 * finds nothing keeps nothing. Regions are 8-connected, so a limb joined at a
 * corner stays joined. Pure; a fresh raster.
 */
export function keepTouching(
  raster: BrushRaster,
  seeds: readonly { x: number; y: number }[],
  reach = Math.max(2, Math.round(Math.max(raster.width, raster.height) / 100)),
): BrushRaster {
  const { width: w, height: h, data: src } = raster;
  const kept = new Uint8Array(src.length);
  const stack = new Int32Array(src.length);
  for (const seed of seeds) {
    const start = nearestIn(raster, seed, reach);
    if (start < 0 || kept[start]) continue;
    let top = 0;
    stack[top++] = start;
    kept[start] = 1;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (kept[j] || src[j] < IN) continue;
          kept[j] = 1;
          stack[top++] = j;
        }
      }
    }
  }
  const data = new Uint8Array(src.length);
  for (let i = 0; i < data.length; i += 1) data[i] = kept[i] ? src[i] : 0;
  return { data, width: w, height: h };
}

/** The covered pixel nearest a point, within `reach`, or −1. */
function nearestIn(raster: BrushRaster, seed: { x: number; y: number }, reach: number): number {
  const { width: w, height: h, data } = raster;
  const px = Math.min(w - 1, Math.max(0, Math.floor(seed.x * w)));
  const py = Math.min(h - 1, Math.max(0, Math.floor(seed.y * h)));
  if (data[py * w + px] >= IN) return py * w + px;
  let best = -1;
  let bestD = Infinity;
  for (let y = Math.max(0, py - reach); y <= Math.min(h - 1, py + reach); y += 1) {
    for (let x = Math.max(0, px - reach); x <= Math.min(w - 1, px + reach); x += 1) {
      if (data[y * w + x] < IN) continue;
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d <= reach * reach && d < bestD) {
        bestD = d;
        best = y * w + x;
      }
    }
  }
  return best;
}

/** `grow` pixels at the reference edge, as pixels of this raster. */
export function growPixels(grow: number, raster: { width: number; height: number }): number {
  return (grow * Math.max(raster.width, raster.height)) / GROW_REFERENCE_EDGE;
}

/**
 * The edge moved by `px` pixels of THIS raster — out for a positive value,
 * in for a negative one — by an exact Euclidean distance, so the subject grows
 * by a disc and not a square. The picture's own border is not an edge: a
 * subject cut by the frame does not shrink away from it, since it goes on
 * past what the frame shows. Pure; a fresh raster (all 255 or 0).
 */
export function growShrink(raster: BrushRaster, px: number): BrushRaster {
  const { width: w, height: h, data: src } = raster;
  if (!px) return { data: new Uint8Array(src), width: w, height: h };
  const grow = px > 0;
  // Squared distance to the nearest pixel of the other side: to the subject
  // when growing, to the ground when shrinking.
  const d2 = squaredDistance(w, h, (i) => (grow ? src[i] >= IN : src[i] < IN));
  const r2 = px * px;
  const data = new Uint8Array(src.length);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = grow ? (d2[i] <= r2 ? 255 : 0) : src[i] >= IN && d2[i] > r2 ? 255 : 0;
  }
  return { data, width: w, height: h };
}

const FAR = 1e20;

/**
 * Felzenszwalb and Huttenlocher's exact squared Euclidean distance transform:
 * for every pixel, the squared distance to the nearest `feature` pixel — FAR
 * where there is none. Linear in the pixel count (two 1D passes), about
 * 15 ms at the model's 1024 px view.
 */
export function squaredDistance(w: number, h: number, feature: (i: number) => boolean): Float64Array {
  const out = new Float64Array(w * h);
  for (let i = 0; i < out.length; i += 1) out[i] = feature(i) ? 0 : FAR;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) f[y] = out[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y += 1) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) f[x] = out[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x += 1) out[row + x] = d[x];
  }
  return out;
}

/** The lower envelope of parabolas rooted at `f` — one row or column of the transform. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}
