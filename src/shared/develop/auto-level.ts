/**
 * AUTO LEVEL — the horizon (or an upright) found by itself, as the angle the
 * Crop tab's Straighten should take. Pure, DOM-free, tested.
 *
 * The horizon is the DOMINANT straight line near horizontal or vertical. It
 * is read the way a Level line is drawn: every pixel's gradient says which
 * way the picture's edges run there (a Scharr gradient), each edge's direction is folded to its
 * deviation from the nearest axis (a wall tilted 2° and a horizon tilted 2°
 * vote for the same correction — the fold `levelDelta` makes), the deviations
 * are histogrammed within `MAX_TILT`, weighted by how strong the edge is, and
 * the peak is refined by a weighted mean. A picture is tilted by a few
 * degrees or it is composed that way: past `MAX_TILT` nothing votes.
 *
 * What makes the answer honest is the CONFIDENCE: the share of the edge mass
 * within a degree of the peak. A flat field, pure noise, a forest with lines
 * every way — the mass spreads, the share stays low, and the verb says "no
 * line to level on" rather than turning the picture by the loudest accident.
 * Both the floor and the window are taste constants, named so they can be
 * moved from the maintainer's pictures (`docs/auto-develop.md` §8).
 *
 * Conventions: screen axes, y down. A line falling to the right has a
 * positive angle and is a clockwise tilt; the correction is anticlockwise,
 * which is `levelDelta`'s own rule, so the two ways of levelling can never
 * disagree about a sign.
 */

import { levelDelta } from './crop-rect';

/** A grey picture, row-major, any range (only ratios of gradients are read). */
export interface LumaRaster {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** What the measurement found. */
export interface Tilt {
  /** The dominant line's deviation from its axis, degrees, screen convention. */
  tilt: number;
  /** The fine straighten that levels it — `levelDelta`'s answer for that line. */
  correction: number;
  /** Share of the edge mass within `PEAK_WINDOW` of the peak, 0..1. */
  confidence: number;
}

/** Deviations past this do not vote: a picture that far off is composed that way. */
export const MAX_TILT = 15;
/** The histogram's step, degrees. */
const STEP = 0.1;
/** The window the peak is refined and its share measured over, degrees. */
export const PEAK_WINDOW = 1;
/** Below this share of the mass, there is no line worth levelling on. */
export const CONFIDENCE_FLOOR = 0.2;
/** Only edges stronger than this share of the strongest vote — texture and noise do not. */
const EDGE_FLOOR = 0.15;
/** A tilt under this reads as level already. */
export const LEVEL_EPS = 0.05;
/** The long edge the picture is read at: enough for a tenth of a degree, cheap. */
export const LEVEL_SAMPLE_EDGE = 512;

const DEG = 180 / Math.PI;

/** Rec.709 luma of RGBA bytes, for a sample read off a canvas. */
export function lumaOf(rgba: ArrayLike<number>, width: number, height: number): LumaRaster {
  const n = width * height;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    data[i] = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
  }
  return { data, width, height };
}

/**
 * A 5-tap binomial blur, separable, edges clamped. WITHOUT it a nearly
 * horizontal edge is a staircase whose long runs vote for 0° and whose steps
 * alone carry the angle; widened to a few pixels the gradient carries the
 * true direction everywhere along the edge.
 */
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

/** An edge's direction folded to its deviation from the nearest axis, (−45, 45]. */
function foldToAxis(lineDeg: number): number {
  let a = lineDeg;
  // (−90, 90]
  while (a > 90) a -= 180;
  while (a <= -90) a += 180;
  return Math.abs(a) <= 45 ? a : a - Math.sign(a) * 90;
}

/**
 * The dominant tilt of `luma`, or null when nothing in the picture says one
 * with enough confidence.
 */
export function measureTilt(luma: LumaRaster, maxTilt = MAX_TILT): Tilt | null {
  const { width: w, height: h } = luma;
  if (w < 5 || h < 5) return null;
  const data = blur(luma);

  // A gradient per interior pixel; the line's direction is the gradient's
  // perpendicular: atan2(gx, −gy) is 0 for a horizon (dark below bright).
  const count = (w - 2) * (h - 2);
  const mags = new Float32Array(count);
  const devs = new Float32Array(count);
  let maxMag = 0;
  let k = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const tl = data[i - w - 1];
      const t = data[i - w];
      const tr = data[i - w + 1];
      const l = data[i - 1];
      const r = data[i + 1];
      const bl = data[i + w - 1];
      const b = data[i + w];
      const br = data[i + w + 1];
      // Scharr's weights (3, 10, 3), not Sobel's (1, 2, 1): Sobel's kernel is
      // not rotation-symmetric and reads a 4° edge as 3.8° — a measured 5 %
      // shrink on every angle — where Scharr's is exact to the tenth.
      const gx = 3 * tr + 10 * r + 3 * br - (3 * tl + 10 * l + 3 * bl);
      const gy = 3 * bl + 10 * b + 3 * br - (3 * tl + 10 * t + 3 * tr);
      const m = Math.hypot(gx, gy);
      mags[k] = m;
      devs[k] = m > 0 ? foldToAxis(Math.atan2(gx, -gy) * DEG) : 0;
      if (m > maxMag) maxMag = m;
      k += 1;
    }
  }
  if (!(maxMag > 0)) return null;

  const bins = Math.round((2 * maxTilt) / STEP) + 1;
  const hist = new Float64Array(bins);
  const floor = maxMag * EDGE_FLOOR;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const m = mags[i];
    if (m < floor) continue;
    const d = devs[i];
    if (Math.abs(d) > maxTilt) continue;
    hist[Math.round((d + maxTilt) / STEP)] += m;
    total += m;
  }
  if (!(total > 0)) return null;

  // Smoothed over the window, so a peak split across two bins still wins.
  const half = Math.round(PEAK_WINDOW / STEP / 2);
  let peak = 0;
  let peakMass = -1;
  for (let i = 0; i < bins; i += 1) {
    let s = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(bins - 1, i + half); j += 1) s += hist[j];
    if (s > peakMass) {
      peakMass = s;
      peak = i;
    }
  }
  // Refined: the weighted mean of the deviations within the window of the peak.
  const win = Math.round(PEAK_WINDOW / STEP);
  let mass = 0;
  let sum = 0;
  for (let j = Math.max(0, peak - win); j <= Math.min(bins - 1, peak + win); j += 1) {
    mass += hist[j];
    sum += hist[j] * (j * STEP - maxTilt);
  }
  const confidence = mass / total;
  if (!(mass > 0) || confidence < CONFIDENCE_FLOOR) return null;
  const raw = sum / mass;
  const tilt = Math.abs(raw) < LEVEL_EPS ? 0 : Math.round(raw * 10) / 10;
  const a = tilt / DEG;
  return { tilt, correction: tilt === 0 ? 0 : levelDelta(0, 0, Math.cos(a), Math.sin(a)), confidence };
}

/**
 * The fine straighten to SET for a measured tilt, given how the picture is
 * mirrored: a flip reverses what way a line falls, so the correction follows.
 * The quarter turn needs no account — a tilt keeps its sign through it, and
 * the crop API adds the quarter itself.
 */
export function levelFine(tilt: Tilt, flipX: boolean, flipY: boolean): number {
  return flipX !== flipY ? -tilt.correction : tilt.correction;
}

/** What Auto level did, for the line that reports it. */
export function describeTilt(tilt: Tilt | null): string {
  if (!tilt) return 'no line to level on';
  if (tilt.tilt === 0) return 'level already';
  const pct = Math.round(tilt.confidence * 100);
  return `levelled by ${tilt.correction > 0 ? '+' : ''}${tilt.correction.toFixed(1)}° · ${pct} % of the edges agree`;
}
