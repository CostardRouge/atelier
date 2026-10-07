/**
 * The camera's OWN tone curve, MEASURED on the render a RAW carries — what
 * the base curve's `auto` stores (`base-curve.ts`).
 *
 * Both pictures are the same capture: the sensor's linear light (decoded,
 * brought to its metered exposure) and the 8-bit render the camera wrote
 * from it. Pixel for pixel, the render's luminance as a function of the
 * sensor's IS the camera's curve — on luminance, as every stage of the
 * develop, so its colour (the camera's own matrix and saturation) is not
 * asked for here.
 *
 * The two frames are not quite the same frame: a render is cropped a few
 * pixels (Sony: 7008 × 4672 of 7040 × 4688) or MAGNIFIED (a DJI DNG's render
 * is 4.93 % tighter than its sensor, `raw.md`). So both are read on a coarse
 * GRID, the render through a magnification searched over a few percent about
 * the centre, and only cells FLAT on the sensor are kept — an edge
 * mis-registered by a cell would read as a wild point. Each band of the
 * sensor's tone answers with its MEDIAN render, the medians are made to rise
 * (pool-adjacent-violators), and the curve is those points through the same
 * monotone cubic every curve of the suite draws.
 *
 * It REFUSES rather than invents: a render too small to measure, a frame of
 * another shape, too few tones in the picture, or a render that does not
 * follow ONE curve (a camera's local tone mapping, a different crop) — the
 * caller then falls back to Standard and says why. Pure and DOM-free.
 */

import { makeCurve, type CurvePoint } from './curves';
import { encodeTone } from './develop';

/** A plane of one value per pixel, top row first. */
export interface LumaPlane {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * The smallest render worth measuring, on its long edge. On a synthetic
 * capture (`base-curve-fit.test.ts`) the grid reads the curve back within
 * two codes from 1920 px down to 320 — size is not what breaks a fit there —
 * so this is a guard against the renders that are THUMBNAILS: the 160 × 120
 * JPEG inside a Sony HIF, a DNG's 256 px preview, whose JPEG at that size is
 * all block and no tone. A DJI DNG's 960 × 540 passes it; what makes that one
 * fragile is its 4.93 % magnification, which the scale search answers.
 */
export const FIT_MIN_RENDER_EDGE = 640;

/**
 * The most a render may stray from the curve fitted to it, as the MEDIAN
 * over the grid in 8-bit codes, before the fit is refused. One curve
 * explains a camera's global tone to a code or two (JPEG rounding, the
 * camera's colour moving luminance a little); a local tone mapping or a
 * different crop leaves several.
 */
export const FIT_MAX_ERROR = 4;

/**
 * The most two HALVES of the frame (left and right, top and bottom) may
 * disagree, band by band, in codes: a camera's global curve is the same in
 * both, a local tone mapping lifts one side's shadows and not the other's.
 * The median residual alone is too forgiving to see it (a hard local map read
 * 4.4 codes of median residual, measured); halves read it at once.
 */
export const FIT_MAX_SPLIT = 6;

/** Cells across the sensor's long edge. */
const GRID = 72;
/** A cell whose encoded tone spans more than this is an edge, not a tone. */
const FLAT = 0.05;
/** Bands of the sensor's encoded tone the medians are taken in. */
const BANDS = 24;
/** Cells a band needs to say anything. */
const MIN_PER_BAND = 4;
/** The magnifications searched, render about the sensor's centre. */
const SCALES: readonly number[] = Array.from({ length: 21 }, (_, i) => 0.98 + i * 0.005);

export type BaseCurveFit =
  | { ok: true; points: CurvePoint[]; error: number; scale: number }
  | { ok: false; reason: string; error?: number };

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The render's mean value over a box of its normalised coordinates, by 3 × 3 bilinear samples. */
function renderBox(render: LumaPlane, u0: number, v0: number, u1: number, v1: number): number {
  const { width: w, height: h, data } = render;
  let sum = 0;
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const x = (u0 + ((i + 0.5) / 3) * (u1 - u0)) * w - 0.5;
      const y = (v0 + ((j + 0.5) / 3) * (v1 - v0)) * h - 0.5;
      const xi = Math.max(0, Math.min(w - 2, Math.floor(x)));
      const yi = Math.max(0, Math.min(h - 2, Math.floor(y)));
      const fx = Math.max(0, Math.min(1, x - xi));
      const fy = Math.max(0, Math.min(1, y - yi));
      const a = data[yi * w + xi];
      const b = data[yi * w + xi + 1];
      const c = data[(yi + 1) * w + xi];
      const d = data[(yi + 1) * w + xi + 1];
      sum += (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return sum / 9;
}

interface Cell {
  /** Centre and half-size, normalised to the sensor's frame. */
  u: number;
  v: number;
  hu: number;
  hv: number;
  /** The sensor's tone there, extended-encoded (`encodeTone`). */
  x: number;
}

/** The sensor read on the grid: the FLAT cells and their tone. */
function sensorCells(sensor: LumaPlane): Cell[] {
  const { width: w, height: h, data } = sensor;
  const gw = w >= h ? GRID : Math.max(2, Math.round((GRID * w) / h));
  const gh = w >= h ? Math.max(2, Math.round((GRID * h) / w)) : GRID;
  const cells: Cell[] = [];
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * h) / gh);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * w) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / gw));
      let sum = 0;
      let n = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = data[y * w + x];
          sum += v;
          n += 1;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (!n) continue;
      const mean = sum / n;
      if (!(mean > 0)) continue;
      if (encodeTone(Math.max(hi, 0)) - encodeTone(Math.max(lo, 0)) > FLAT) continue;
      cells.push({ u: (x0 + x1) / 2 / w, v: (y0 + y1) / 2 / h, hu: (x1 - x0) / 2 / w, hv: (y1 - y0) / 2 / h, x: encodeTone(mean) });
    }
  }
  return cells;
}

/** The render's tone for every cell under one magnification; NaN where it falls outside the render. */
function pairsAt(cells: readonly Cell[], render: LumaPlane, scale: number): { x: number; y: number; u: number; v: number }[] {
  const out: { x: number; y: number; u: number; v: number }[] = [];
  for (const c of cells) {
    // A point at `c` from the sensor's centre is at `c × scale` from the render's.
    const u0 = 0.5 + (c.u - c.hu - 0.5) * scale;
    const u1 = 0.5 + (c.u + c.hu - 0.5) * scale;
    const v0 = 0.5 + (c.v - c.hv - 0.5) * scale;
    const v1 = 0.5 + (c.v + c.hv - 0.5) * scale;
    if (u0 < 0 || v0 < 0 || u1 > 1 || v1 > 1) continue;
    // The curve is drawn on the displayed range; the headroom above white is the line it continues on.
    if (c.x > 1) continue;
    out.push({ x: c.x, y: renderBox(render, u0, v0, u1, v1), u: c.u, v: c.v });
  }
  return out;
}

/** Each band's median render tone, by band index; NaN where the band holds too few cells. */
function bandMedians(pairs: readonly { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (let b = 0; b < BANDS; b++) {
    const lo = b / BANDS;
    const hi = (b + 1) / BANDS;
    const ys = pairs.filter((p) => p.x >= lo && (b === BANDS - 1 ? p.x <= hi : p.x < hi)).map((p) => p.y);
    out.push(ys.length >= MIN_PER_BAND ? median(ys) : NaN);
  }
  return out;
}

/** How far two halves of the frame disagree: the worst, over both splits, of the median band gap, in codes. */
function splitGap(pairs: readonly { x: number; y: number; u: number; v: number }[]): number {
  let worst = 0;
  for (const side of ['u', 'v'] as const) {
    const a = bandMedians(pairs.filter((p) => p[side] < 0.5));
    const b = bandMedians(pairs.filter((p) => p[side] >= 0.5));
    const gaps = a.map((y, i) => Math.abs(y - b[i])).filter((g) => Number.isFinite(g));
    if (gaps.length >= 3) worst = Math.max(worst, median(gaps) * 255);
  }
  return worst;
}

/** The points of one curve through `pairs`: band medians, made to rise, anchored at black and white. */
function curveThrough(pairs: readonly { x: number; y: number }[]): CurvePoint[] | null {
  const bands: { x: number; y: number; n: number }[] = [];
  for (let b = 0; b < BANDS; b++) {
    const lo = b / BANDS;
    const hi = (b + 1) / BANDS;
    const inBand = pairs.filter((p) => p.x >= lo && (b === BANDS - 1 ? p.x <= hi : p.x < hi));
    if (inBand.length < MIN_PER_BAND) continue;
    bands.push({ x: median(inBand.map((p) => p.x)), y: median(inBand.map((p) => p.y)), n: inBand.length });
  }
  if (bands.length < 6 || bands[bands.length - 1].x - bands[0].x < 0.45) return null;
  // Pool adjacent violators: the medians made non-decreasing, weighted by their cells.
  const blocks = bands.map((b) => ({ y: b.y, n: b.n, count: 1 }));
  for (let i = 0; i < blocks.length - 1; ) {
    if (blocks[i].y > blocks[i + 1].y) {
      const a = blocks[i];
      const b = blocks[i + 1];
      blocks.splice(i, 2, { y: (a.y * a.n + b.y * b.n) / (a.n + b.n), n: a.n + b.n, count: a.count + b.count });
      if (i > 0) i -= 1;
    } else i += 1;
  }
  const ys: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.count; k++) ys.push(b.y);
  const points: CurvePoint[] = [{ x: 0, y: 0 }];
  bands.forEach((b, i) => {
    if (b.x > 0 && b.x < 1 && b.x > points[points.length - 1].x) points.push({ x: b.x, y: Math.max(points[points.length - 1].y, Math.min(1, ys[i])) });
  });
  // White: where the last two bands lead, held between the last value and 1 —
  // or white itself when the picture holds no tone near it to say otherwise.
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  let top = 1;
  if (last.x >= 0.85 && prev && last.x > prev.x) {
    const slope = (last.y - prev.y) / (last.x - prev.x);
    top = Math.min(1, Math.max(last.y, last.y + slope * (1 - last.x)));
  }
  points.push({ x: 1, y: top });
  return points;
}

/**
 * Fit the camera's curve: `sensor` is the decoded sensor's LINEAR luminance
 * at its metered exposure (white at 1, headroom above), `render` the
 * camera's render as ENCODED luminance in [0,1], each at any size; `renderEdge`
 * is the render's OWN long edge, before it was scaled to be read.
 */
export function fitBaseCurve(sensor: LumaPlane, render: LumaPlane, renderEdge: number): BaseCurveFit {
  if (renderEdge < FIT_MIN_RENDER_EDGE) {
    return { ok: false, reason: `its render is ${renderEdge} px on the long edge — too small to measure a curve on (${FIT_MIN_RENDER_EDGE} at least)` };
  }
  const sa = sensor.width / sensor.height;
  const ra = render.width / render.height;
  if (Math.abs(sa - ra) / sa > 0.03) return { ok: false, reason: 'its render frames another shape than its sensor' };
  const cells = sensorCells(sensor);
  let best: { points: CurvePoint[]; error: number; scale: number; split: number } | null = null;
  for (const scale of SCALES) {
    const pairs = pairsAt(cells, render, scale);
    const points = curveThrough(pairs);
    if (!points) continue;
    const f = makeCurve(points);
    const error = median(pairs.map((p) => Math.abs(p.y - f(p.x)))) * 255;
    if (!best || error < best.error) best = { points, error, scale, split: splitGap(pairs) };
  }
  if (!best) return { ok: false, reason: 'the picture holds too few tones to measure a curve on' };
  if (best.error > FIT_MAX_ERROR) {
    return {
      ok: false,
      reason: `its render does not follow one curve (${best.error.toFixed(1)} codes off) — a local tone mapping or another crop`,
      error: best.error,
    };
  }
  if (best.split > FIT_MAX_SPLIT) {
    return {
      ok: false,
      reason: `its render does not follow one curve — two halves of the frame differ by ${best.split.toFixed(1)} codes (a local tone mapping)`,
      error: best.split,
    };
  }
  // Two decimals of a code are what the stored points can mean.
  const points = best.points.map((p) => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 }));
  return { ok: true, points, error: Math.round(best.error * 100) / 100, scale: best.scale };
}
