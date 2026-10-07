/**
 * AUTO UPRIGHT — the perspective a lens pointed up or down put into a
 * building, measured from the picture and taken back out: the Perspective
 * fold's Vertical and Horizontal solved from the lines that converge, and
 * the Zoom that hides the corners the correction empties. Lightroom's
 * Upright, Capture One's Keystone, as ONE switch. Pure, DOM-free, tested.
 *
 * How it reads the picture: the same Scharr gradient as Auto level
 * (`auto-level.ts`), and every strong edge that runs NEAR VERTICAL is taken as
 * a piece of a line — its tilt `t = dx/dy` (how far it drifts across per pixel
 * down) and where that line crosses the picture's middle row, `u`. Lines that
 * converge toward one vanishing point obey `t = k · u`: a line further from
 * the centre leans more, in proportion. So the tilts are REGRESSED on the
 * crossings, weighted by edge strength, and the slope `k` is the whole
 * answer — because the keystone's own matrix (`geometry.ts`) divides by
 * `1 + v·y`, and a line `x = u·(1 − y/Y)` goes vertical under it exactly when
 * `v = −1/Y = k`. The horizontal axis is the same reading turned a quarter.
 * So the number written is SOLVED against this suite's own matrix, and the
 * spec proves the lines come out parallel through it.
 *
 * What makes the answer honest is the CONFIDENCE: the share of the tilts'
 * variance the one slope explains (a weighted r²), asked only when enough of
 * the picture's edges run near the axis and they are spread across it — a
 * flat field, a forest, a single pole say "no verticals to right" rather than
 * bending the picture on an accident. The floors are taste constants, named
 * so they can be moved from the maintainer's pictures.
 *
 * Conventions: screen axes, y down, as `auto-level.ts`. The regression runs in
 * the matrix's SQUARE space — both axes in units of the picture's HEIGHT — so
 * one `k` means the same on a 3:2 and on a 4:5.
 */

import { lumaOf, type LumaRaster } from './auto-level';
import {
  DEFAULT_KEYSTONE,
  PERSPECTIVE_REACH,
  applyMatrix3,
  keystoneSampleMatrix,
  type Keystone,
} from '../render/geometry';

export { lumaOf };

/** The long edge the picture is read at — Auto level's. */
export const UPRIGHT_SAMPLE_EDGE = 512;
/** Edges further than this from an axis do not vote: a diagonal is not a leaning vertical. */
export const MAX_LEAN = 15;
/** Only edges stronger than this share of the strongest vote. */
const EDGE_FLOOR = 0.15;
/** Below this share of the strong edges running near the axis, there is nothing to right. */
export const MIN_AXIS_SHARE = 0.08;
/** The crossings must spread at least this far (in heights) for a slope to mean anything. */
export const MIN_SPREAD = 0.12;
/** Below this r², the lines do not agree on one vanishing point. */
export const CONFIDENCE_FLOOR = 0.35;
/** The second pass keeps the edges within this of the first slope's line — un-truncating the outer lines. */
export const RESIDUAL_LEAN = 4;
/** Edges whose crossings sit within this (in heights) belong to one line, whose slope is then read from its PIXELS. */
const CLUSTER_GAP = 0.015;
/** A correction under this many slider units reads as upright already. */
export const UPRIGHT_EPS = 1;

const DEG = 180 / Math.PI;

/** What one axis' reading found. */
export interface AxisLean {
  /** The slope `k` — the matrix's own perspective term, in square space. */
  k: number;
  /** The slider value SOLVED for it, −100..100, rounded. */
  value: number;
  /** r² of the regression, 0..1. */
  confidence: number;
  /** Share of the strong edges that ran near this axis. */
  share: number;
  /** The slider ran out before the vanishing point. */
  clamped: boolean;
}

export interface Upright {
  vertical: AxisLean | null;
  horizontal: AxisLean | null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The 5-tap binomial blur `auto-level.ts` uses, for the same reason. */
function blur(luma: LumaRaster): Float32Array {
  const { data, width: w, height: h } = luma;
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let t = -2; t <= 2; t += 1) {
        const xx = x + t < 0 ? 0 : x + t >= w ? w - 1 : x + t;
        s += k[t + 2] * data[y * w + xx];
      }
      tmp[y * w + x] = s / 16;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let t = -2; t <= 2; t += 1) {
        const yy = y + t < 0 ? 0 : y + t >= h ? h - 1 : y + t;
        s += k[t + 2] * tmp[yy * w + x];
      }
      out[y * w + x] = s / 16;
    }
  }
  return out;
}

interface Edge {
  /** Square-space position: both in units of the height, centred. */
  x: number;
  y: number;
  /** Line direction, unit, y component made positive for the vertical reading. */
  dx: number;
  dy: number;
  mag: number;
}

/** A weighted regression of `t` on `u`: the slope and its r². */
function regress(us: Float64Array, ts: Float64Array, ws: Float64Array, n: number): { k: number; r2: number; spread: number } | null {
  let sw = 0;
  let su = 0;
  let st = 0;
  for (let i = 0; i < n; i += 1) {
    sw += ws[i];
    su += ws[i] * us[i];
    st += ws[i] * ts[i];
  }
  if (!(sw > 0)) return null;
  const um = su / sw;
  const tm = st / sw;
  let suu = 0;
  let sut = 0;
  let stt = 0;
  for (let i = 0; i < n; i += 1) {
    const du = us[i] - um;
    const dt = ts[i] - tm;
    suu += ws[i] * du * du;
    sut += ws[i] * du * dt;
    stt += ws[i] * dt * dt;
  }
  if (!(suu > 0)) return null;
  const k = sut / suu;
  // r² — and a set of lines all parallel (no tilt variance at all) explains
  // itself perfectly: the slope is 0 and the picture is upright.
  const r2 = stt > 1e-12 ? (sut * sut) / (suu * stt) : 1;
  return { k, r2, spread: Math.sqrt(suu / sw) };
}

/**
 * One axis read: the edges near it, their line's crossing of the middle
 * line, their tilt, the regression. `axis` 'vertical' reads the lines that
 * stand, 'horizontal' the lines that lie, by swapping the roles of x and y.
 */
function readAxis(edges: readonly Edge[], totalMag: number, axis: 'vertical' | 'horizontal', maxLean: number): AxisLean | null {
  const limit = Math.tan((maxLean / 180) * Math.PI);
  // Gathered out to TWICE the lean, so the second pass can take back the
  // pixels of an outer line that the first pass's hard cut dropped.
  const wide = Math.tan(((2 * maxLean) / 180) * Math.PI);
  const us = new Float64Array(edges.length);
  const ts = new Float64Array(edges.length);
  const ws = new Float64Array(edges.length);
  const ps = new Float64Array(edges.length);
  const ds = new Float64Array(edges.length);
  let n = 0;
  for (const e of edges) {
    // The line's along-axis and across-axis components, the along one made positive.
    let along = axis === 'vertical' ? e.dy : e.dx;
    let across = axis === 'vertical' ? e.dx : e.dy;
    if (along < 0) {
      along = -along;
      across = -across;
    }
    if (!(along > 0)) continue;
    const t = across / along;
    if (Math.abs(t) > wide) continue;
    const pos = axis === 'vertical' ? e.x : e.y;
    const depth = axis === 'vertical' ? e.y : e.x;
    // Where THIS line crosses the middle of the picture: `t` is the drift per
    // unit of depth, so walking back `depth` along it lands on the axis' zero.
    us[n] = pos - t * depth;
    ts[n] = t;
    ws[n] = e.mag;
    ps[n] = pos;
    ds[n] = depth;
    n += 1;
  }
  // Pass 1: the edges within the lean. Its r² and share are what the answer is trusted on.
  const pick = (keep: (u: number, t: number) => boolean) => {
    const pu = new Float64Array(n);
    const pt = new Float64Array(n);
    const pw = new Float64Array(n);
    const idx = new Int32Array(n);
    let m = 0;
    let mass = 0;
    for (let i = 0; i < n; i += 1) {
      if (!keep(us[i], ts[i])) continue;
      pu[m] = us[i];
      pt[m] = ts[i];
      pw[m] = ws[i];
      idx[m] = i;
      m += 1;
      mass += ws[i];
    }
    return { pu, pt, pw, idx, m, mass };
  };
  const first = pick((_u, t) => Math.abs(t) <= limit);
  const share = totalMag > 0 ? first.mass / totalMag : 0;
  if (first.m < 16 || share < MIN_AXIS_SHARE) return null;
  const fit = regress(first.pu, first.pt, first.pw, first.m);
  if (!fit || fit.spread < MIN_SPREAD) return null;
  const askedFirst = (100 * fit.k) / PERSPECTIVE_REACH;
  if (fit.r2 < CONFIDENCE_FLOOR) {
    // Lines that spread but do not lean more than their noise: upright
    // already. A lean the noise does not explain, with no agreement: refused.
    return Math.abs(askedFirst) < 2 * UPRIGHT_EPS ? { k: 0, value: 0, confidence: fit.r2, share, clamped: false } : null;
  }
  // Pass 2: every edge that FITS that slope, the hard cut gone — a cut at
  // 15° kept only the inner pixels of a line leaning 14°, and read every
  // slope a few percent low (measured in the spec).
  const tolerance = Math.tan((RESIDUAL_LEAN / 180) * Math.PI);
  const second = pick((u, t) => Math.abs(t - fit.k * u) <= tolerance);
  const refit = second.m >= 16 ? regress(second.pu, second.pt, second.pw, second.m) : null;
  // Pass 3: a line is where its PIXELS are. The gradient's angle is exact to
  // a tenth of a degree near the axis and a few tenths at 14°, which read
  // every slope a percent or two low (measured); the pixels of one line
  // (its edges clustered by their crossing) fit a slope with no such bias.
  const lined = refit ? linesOf(second, ps, ds, fit.k) : null;
  const k = lined ?? (refit ? refit.k : fit.k);
  const asked = (100 * k) / PERSPECTIVE_REACH;
  const value = Math.round(clamp(asked, -100, 100));
  return { k, value: Math.abs(value) < UPRIGHT_EPS ? 0 : value, confidence: fit.r2, share, clamped: Math.abs(asked) > 100.5 };
}

/**
 * The slope of the lines read from their pixels: the inliers sorted by
 * crossing, cut into lines where the crossings gap, each line fitted
 * `pos = a + b·depth` by weighted least squares, and the lines' slopes
 * regressed on their crossings. Null when fewer than two lines can be fitted.
 */
function linesOf(
  inliers: { pu: Float64Array; pw: Float64Array; idx: Int32Array; m: number },
  ps: Float64Array,
  ds: Float64Array,
  k0: number,
): number | null {
  const order = Array.from({ length: inliers.m }, (_, i) => i).sort((a, b) => inliers.pu[a] - inliers.pu[b]);
  const lineU: number[] = [];
  const lineT: number[] = [];
  const lineW: number[] = [];
  let start = 0;
  const fitLine = (from: number, to: number) => {
    let sw = 0;
    let sd = 0;
    let sp = 0;
    for (let j = from; j < to; j += 1) {
      const i = inliers.idx[order[j]];
      const w = inliers.pw[order[j]];
      sw += w;
      sd += w * ds[i];
      sp += w * ps[i];
    }
    if (!(sw > 0)) return;
    const dm = sd / sw;
    const pm = sp / sw;
    let sdd = 0;
    let sdp = 0;
    for (let j = from; j < to; j += 1) {
      const i = inliers.idx[order[j]];
      const w = inliers.pw[order[j]];
      sdd += w * (ds[i] - dm) * (ds[i] - dm);
      sdp += w * (ds[i] - dm) * (ps[i] - pm);
    }
    // A line needs a reach along its axis to carry a slope: a tenth of the height.
    if (to - from < 8 || Math.sqrt(sdd / sw) < 0.1) return;
    const b = sdp / sdd;
    lineT.push(b);
    lineU.push(pm - b * dm);
    lineW.push(sw);
  };
  for (let j = 1; j <= inliers.m; j += 1) {
    if (j === inliers.m || inliers.pu[order[j]] - inliers.pu[order[j - 1]] > CLUSTER_GAP) {
      fitLine(start, j);
      start = j;
    }
  }
  if (lineU.length < 2) return null;
  const fit = regress(Float64Array.from(lineU), Float64Array.from(lineT), Float64Array.from(lineW), lineU.length);
  // The lines' own slope must agree with the edges' within reason, or the clustering merged what it should not.
  return fit && Math.abs(fit.k - k0) < 0.25 * Math.max(Math.abs(k0), 0.05) ? fit.k : null;
}

/**
 * The lean of `luma` on both axes — each null when nothing in the picture
 * says one with enough confidence. The vertical reading is the one a
 * building needs; the horizontal one, a wall shot from the side.
 */
export function measureUpright(luma: LumaRaster, maxLean = MAX_LEAN): Upright {
  const { width: w, height: h } = luma;
  if (w < 8 || h < 8) return { vertical: null, horizontal: null };
  const data = blur(luma);
  const edges: Edge[] = [];
  let maxMag = 0;
  const mags = new Float32Array((w - 2) * (h - 2));
  let k = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx = 3 * data[i - w + 1] + 10 * data[i + 1] + 3 * data[i + w + 1] - (3 * data[i - w - 1] + 10 * data[i - 1] + 3 * data[i + w - 1]);
      const gy = 3 * data[i + w - 1] + 10 * data[i + w] + 3 * data[i + w + 1] - (3 * data[i - w - 1] + 10 * data[i - w] + 3 * data[i - w + 1]);
      const m = Math.hypot(gx, gy);
      mags[k] = m;
      k += 1;
      if (m > maxMag) maxMag = m;
    }
  }
  if (!(maxMag > 0)) return { vertical: null, horizontal: null };
  const floor = maxMag * EDGE_FLOOR;
  let totalMag = 0;
  k = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const m = mags[k];
      k += 1;
      if (m < floor) continue;
      const i = y * w + x;
      const gx = 3 * data[i - w + 1] + 10 * data[i + 1] + 3 * data[i + w + 1] - (3 * data[i - w - 1] + 10 * data[i - 1] + 3 * data[i + w - 1]);
      const gy = 3 * data[i + w - 1] + 10 * data[i + w] + 3 * data[i + w + 1] - (3 * data[i - w - 1] + 10 * data[i - w] + 3 * data[i - w + 1]);
      // The line runs along the gradient's perpendicular; square space, centred, in heights.
      edges.push({ x: (x + 0.5 - w / 2) / h, y: (y + 0.5 - h / 2) / h, dx: -gy / m, dy: gx / m, mag: m });
      totalMag += m;
    }
  }
  return {
    vertical: readAxis(edges, totalMag, 'vertical', maxLean),
    horizontal: readAxis(edges, totalMag, 'horizontal', maxLean),
  };
}

/**
 * The smallest Zoom, 1..3, at which the corrected frame is wholly covered by
 * the picture — the corners a perspective empties hidden, and not one pixel
 * more. Found by bisection over the frame's boundary through the matrix's
 * own inverse; a frame no zoom covers (a fold) gets the ceiling.
 */
export function zoomToCover(k: Keystone, aspectRatio = 1, maxScale = 3, samples = 24): number {
  const covered = (scale: number): boolean => {
    const m = keystoneSampleMatrix({ ...k, scale }, aspectRatio);
    if (!m) return false;
    for (let i = 0; i <= samples; i += 1) {
      const f = i / samples - 0.5;
      for (const [x, y] of [
        [f, -0.5],
        [f, 0.5],
        [-0.5, f],
        [0.5, f],
      ]) {
        const p = applyMatrix3(m, x, y);
        if (!p || Math.abs(p[0]) > 0.5 + 1e-6 || Math.abs(p[1]) > 0.5 + 1e-6) return false;
      }
    }
    return true;
  };
  if (covered(1)) return 1;
  let lo = 1;
  let hi = maxScale;
  if (!covered(hi)) return maxScale;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (covered(mid)) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi * 100) / 100;
}

/**
 * The keystone to SET for a reading: the two perspective sliders written
 * whole, the turn and the stretch kept as the hand left them, the zoom
 * re-solved to cover the frame. Null when neither axis said anything.
 */
export function uprightKeystone(upright: Upright, current: Keystone | null, aspectRatio = 1): Keystone | null {
  if (!upright.vertical && !upright.horizontal) return null;
  const base: Keystone = { ...DEFAULT_KEYSTONE, ...(current ?? {}) };
  const next: Keystone = {
    ...base,
    vertical: upright.vertical ? upright.vertical.value : base.vertical,
    horizontal: upright.horizontal ? upright.horizontal.value : base.horizontal,
    scale: 1,
  };
  return { ...next, scale: zoomToCover(next, aspectRatio) };
}

/** What Auto upright did, for the line that reports it. */
export function describeUpright(upright: Upright): string {
  const { vertical: v, horizontal: h } = upright;
  if (!v && !h) return 'no lines to right on';
  const parts: string[] = [];
  const say = (name: string, a: AxisLean) => {
    if (a.value === 0) parts.push(`${name} upright already`);
    else parts.push(`${name} ${a.value > 0 ? '+' : '−'}${Math.abs(a.value)} · ${Math.round(a.confidence * 100)} % of its lines agree`);
    if (a.clamped) parts.push('as far as the slider reaches');
  };
  if (v) say('vertical', v);
  if (h) say('horizontal', h);
  return parts.join(' · ');
}

/** The lean of a line in degrees, for a spec that thinks in angles. */
export function leanDegrees(k: number, u: number): number {
  return Math.atan(k * u) * DEG;
}
