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
 * - **Edge** is made last: as the model cut it, SOFT (feathered), or SNAPPED
 *   to the picture's own edges by a guided filter over the model's view — the
 *   classic matting refinement (He, Sun and Tang). It moves an edge the model
 *   drew a few pixels off onto the one in the picture; it cannot bring back a
 *   part the model answered 0 for (a thin branch off a tapped trunk comes
 *   back at confidence 0, measured), which is a tap or a painted mask.
 *
 * Pure and DOM-free: the stage (`use-subject-masks.ts`) and the export
 * (`subject-rasters.ts`) both go through `composeSubject`, which calls these,
 * so preview = export holds by construction.
 */

import type { BrushRaster } from '../render/brush-raster';

/** How a subject's edge is drawn: as the model cut it, feathered, or pulled onto the picture's own edges. */
export type SubjectEdge = 'found' | 'soft' | 'snap';
export const SUBJECT_EDGES: readonly SubjectEdge[] = ['found', 'soft', 'snap'];

/** How the author refined a subject. Every field is optional; absent = the model's own answer. */
export interface SubjectRefine {
  /** How unsure the model may be and a pixel still count, in (0,1). 0.5 is the model's own cut. */
  tolerance?: number;
  /** Keep only the regions an added point lands in. */
  islands?: boolean;
  /** Pixels at the model's view: positive grows the subject, negative shrinks it. */
  grow?: number;
  /** The edge, made last: `found` (the cut as it is), `soft` or `snap`. */
  edge?: SubjectEdge;
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
    edge: SUBJECT_EDGES.includes(r?.edge as SubjectEdge) ? (r?.edge as SubjectEdge) : 'found',
  };
}

/** Whether the settings change nothing the model answered. */
export function isDefaultRefine(r: SubjectRefine | null | undefined): boolean {
  const n = normaliseRefine(r);
  return n.tolerance === DEFAULT_TOLERANCE && !n.islands && n.grow === 0 && n.edge === 'found';
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

// ── The edge ────────────────────────────────────────────────────────────────

/** An RGBA picture, a byte per channel — the model's view, read once. */
export interface GuideImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** How far a SOFT edge feathers, in pixels at the reference edge. */
export const SOFT_EDGE_RADIUS = 3;
/** The window a SNAP looks across, in pixels at the reference edge. */
export const SNAP_RADIUS = 8;
/**
 * How strongly a SNAP holds to the mask where the picture is flat: the
 * guided filter's ε, against intensities in [0,1]. Small enough that a real
 * edge (a variance of ~0.01 and up) leads, large enough that the grain of a
 * flat sky does not.
 */
export const SNAP_EPSILON = 1e-4;
/**
 * The matte's contrast after a SNAP: below the floor is ground, above the
 * ceiling subject, a smoothstep between. The guided filter leaves, where the
 * model OVERSHOT an edge, about the share of the window that was wrongly in —
 * a haze of 0.2 to 0.3 a few pixels wide —, and this clears it while a strand
 * the picture shows half-covered stays at one half.
 */
export const SNAP_FLOOR = 0.2;
export const SNAP_CEILING = 0.8;

/**
 * The window mean of `src` (w × h), over a square of radius `r` clipped at
 * the borders — two passes of running sums, linear in the pixel count and
 * walked in memory order.
 */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  // Down the columns first, as a running sum of whole ROWS — the picture is
  // walked in memory order, never with a stride of a row per step.
  const cols = new Float32Array(w);
  const vertical = new Float32Array(w * h);
  for (let y = 0; y <= Math.min(r, h - 1); y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) cols[x] += src[row + x];
  }
  for (let y = 0; y < h; y += 1) {
    const inv = 1 / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
    const row = y * w;
    for (let x = 0; x < w; x += 1) vertical[row + x] = cols[x] * inv;
    if (y + r + 1 < h) {
      const add = (y + r + 1) * w;
      for (let x = 0; x < w; x += 1) cols[x] += src[add + x];
    }
    if (y - r >= 0) {
      const sub = (y - r) * w;
      for (let x = 0; x < w; x += 1) cols[x] -= src[sub + x];
    }
  }
  // Then along each row.
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x += 1) sum += vertical[row + x];
    for (let x = 0; x < w; x += 1) {
      out[row + x] = sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      if (x + r + 1 < w) sum += vertical[row + x + r + 1];
      if (x - r >= 0) sum -= vertical[row + x - r];
    }
  }
  return out;
}

/** A SOFT edge: the mask feathered by two box passes (close to a Gaussian). Pure; a fresh raster. */
export function softEdge(raster: BrushRaster, px: number): BrushRaster {
  const { width: w, height: h } = raster;
  const r = Math.max(1, Math.round(px));
  const f = boxMean(boxMean(Float32Array.from(raster.data), w, h, r), w, h, r);
  const data = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i += 1) data[i] = Math.round(f[i]);
  return { data, width: w, height: h };
}

/**
 * A SNAPPED edge: the colour guided filter of He, Sun and Tang, the mask as
 * its input and the model's view as its guide. Inside a window the output is
 * an affine function of the guide's colour, so where the picture has an edge
 * the mask takes THAT edge, and where it is flat the mask is only smoothed;
 * the matte is then given the contrast of `SNAP_FLOOR` / `SNAP_CEILING`.
 *
 * Run at a fraction of the density (the "fast" guided filter of He and Sun,
 * 2015): the coefficients are computed on a picture downsampled by `step` —
 * 4 at the model's 1024 px view — and spread back bilinearly, and only the
 * final sum is made at full density. Measured on a disc the model drew 3 px
 * too wide: 3 772 px of edge error as found, 1 029 at full density, 343 at a
 * quarter, in 41 ms against 76 at a half (node, 1024 × 683) — the coarse
 * window is both cheaper and the better fit for an overshoot of a few pixels.
 * A guide of another size is stale and refused: the mask comes back
 * unchanged. Pure.
 */
export function snapEdge(
  raster: BrushRaster,
  guide: GuideImage,
  radius: number,
  epsilon = SNAP_EPSILON,
  step = Math.max(1, Math.round(Math.max(raster.width, raster.height) / 256)),
): BrushRaster {
  const { width: w, height: h } = raster;
  if (guide.width !== w || guide.height !== h) return { data: new Uint8Array(raster.data), width: w, height: h };
  // Downsampled guide (three channels) and mask, in [0,1].
  const sw = Math.ceil(w / step);
  const sh = Math.ceil(h / step);
  const n = sw * sh;
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const P = new Float32Array(n);
  const count = new Float32Array(n);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.floor(y / step);
    for (let x = 0; x < w; x += 1) {
      const j = sy * sw + Math.floor(x / step);
      const i = y * w + x;
      R[j] += guide.data[i * 4] / 255;
      G[j] += guide.data[i * 4 + 1] / 255;
      B[j] += guide.data[i * 4 + 2] / 255;
      P[j] += raster.data[i] / 255;
      count[j] += 1;
    }
  }
  for (let j = 0; j < n; j += 1) {
    R[j] /= count[j];
    G[j] /= count[j];
    B[j] /= count[j];
    P[j] /= count[j];
  }
  const r = Math.max(1, Math.round(radius / step));
  const box = (f: Float32Array) => boxMean(f, sw, sh, r);
  const product = (a: Float32Array, b: Float32Array) => {
    const out = new Float32Array(n);
    for (let j = 0; j < n; j += 1) out[j] = a[j] * b[j];
    return out;
  };
  const mR = box(R);
  const mG = box(G);
  const mB = box(B);
  const mP = box(P);
  const cRP = box(product(R, P));
  const cGP = box(product(G, P));
  const cBP = box(product(B, P));
  const vRR = box(product(R, R));
  const vRG = box(product(R, G));
  const vRB = box(product(R, B));
  const vGG = box(product(G, G));
  const vGB = box(product(G, B));
  const vBB = box(product(B, B));
  const aR = new Float32Array(n);
  const aG = new Float32Array(n);
  const aB = new Float32Array(n);
  const b = new Float32Array(n);
  for (let j = 0; j < n; j += 1) {
    // Σ + εI, the guide's colour covariance in the window.
    const rr = vRR[j] - mR[j] * mR[j] + epsilon;
    const rg = vRG[j] - mR[j] * mG[j];
    const rb = vRB[j] - mR[j] * mB[j];
    const gg = vGG[j] - mG[j] * mG[j] + epsilon;
    const gb = vGB[j] - mG[j] * mB[j];
    const bb = vBB[j] - mB[j] * mB[j] + epsilon;
    // Its covariance with the mask.
    const pr = cRP[j] - mR[j] * mP[j];
    const pg = cGP[j] - mG[j] * mP[j];
    const pb = cBP[j] - mB[j] * mP[j];
    // a = Σ⁻¹ · cov, by the adjugate (Σ is symmetric and, with ε, invertible).
    const i00 = gg * bb - gb * gb;
    const i01 = rb * gb - rg * bb;
    const i02 = rg * gb - rb * gg;
    const i11 = rr * bb - rb * rb;
    const i12 = rb * rg - rr * gb;
    const i22 = rr * gg - rg * rg;
    const det = rr * i00 + rg * i01 + rb * i02;
    aR[j] = (i00 * pr + i01 * pg + i02 * pb) / det;
    aG[j] = (i01 * pr + i11 * pg + i12 * pb) / det;
    aB[j] = (i02 * pr + i12 * pg + i22 * pb) / det;
    b[j] = mP[j] - aR[j] * mR[j] - aG[j] * mG[j] - aB[j] * mB[j];
  }
  const maR = box(aR);
  const maG = box(aG);
  const maB = box(aB);
  const mb = box(b);
  // Spread back bilinearly and summed at full density against the full guide:
  // each row of coefficients is interpolated once down the column, then read
  // along it, so the inner loop is arithmetic on arrays and nothing else.
  const x0 = new Int32Array(w);
  const x1 = new Int32Array(w);
  const tx = new Float32Array(w);
  for (let x = 0; x < w; x += 1) {
    const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / step - 0.5));
    x0[x] = Math.floor(fx);
    x1[x] = Math.min(sw - 1, x0[x] + 1);
    tx[x] = fx - x0[x];
  }
  const rowR = new Float32Array(sw);
  const rowG = new Float32Array(sw);
  const rowB = new Float32Array(sw);
  const rowK = new Float32Array(sw);
  const data = new Uint8Array(w * h);
  const span = SNAP_CEILING - SNAP_FLOOR;
  for (let y = 0; y < h; y += 1) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / step - 0.5));
    const y0 = Math.floor(fy) * sw;
    const y1 = Math.min(sh - 1, Math.floor(fy) + 1) * sw;
    const ty = fy - Math.floor(fy);
    for (let k = 0; k < sw; k += 1) {
      rowR[k] = maR[y0 + k] + (maR[y1 + k] - maR[y0 + k]) * ty;
      rowG[k] = maG[y0 + k] + (maG[y1 + k] - maG[y0 + k]) * ty;
      rowB[k] = maB[y0 + k] + (maB[y1 + k] - maB[y0 + k]) * ty;
      rowK[k] = mb[y0 + k] + (mb[y1 + k] - mb[y0 + k]) * ty;
    }
    for (let x = 0; x < w; x += 1) {
      const a = x0[x];
      const c = x1[x];
      const t = tx[x];
      const i = y * w + x;
      const q =
        (rowR[a] + (rowR[c] - rowR[a]) * t) * (guide.data[i * 4] / 255) +
        (rowG[a] + (rowG[c] - rowG[a]) * t) * (guide.data[i * 4 + 1] / 255) +
        (rowB[a] + (rowB[c] - rowB[a]) * t) * (guide.data[i * 4 + 2] / 255) +
        (rowK[a] + (rowK[c] - rowK[a]) * t);
      const u = Math.min(1, Math.max(0, (q - SNAP_FLOOR) / span));
      data[i] = Math.round(u * u * (3 - 2 * u) * 255);
    }
  }
  return { data, width: w, height: h };
}

/**
 * The edge as the author asked for it, at the reference edge's pixels. A snap
 * with no guide (none read yet, or one of another size) leaves the edge as
 * found rather than guessing. Pure.
 */
export function finishEdge(raster: BrushRaster, edge: SubjectEdge, guide?: GuideImage | null): BrushRaster {
  if (edge === 'soft') return softEdge(raster, growPixels(SOFT_EDGE_RADIUS, raster));
  if (edge === 'snap' && guide) return snapEdge(raster, guide, growPixels(SNAP_RADIUS, raster));
  return raster;
}
