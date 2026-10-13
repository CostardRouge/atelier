/**
 * The RIBBON (2026-10-13): the smoothest line that stays within a corridor
 * of every fix — what the vehicle drives when the trip says so
 * (`RoadDrive.style: 'ribbon'`, `road-track.ts`).
 *
 * The maintainer's report on the driver (`steerRoad`, his pick of 2026-10-09):
 * the car no longer trembled, but it FLOATED — aiming half a kilometre ahead,
 * it cut every bend by hundreds of metres and drove beside the road the tiles
 * draw. The ribbon answers both at once, as the road-tremor lab's option A
 * proposed: a draftsman's spline — a flexible strip bent as little as it can
 * be while passing within `withinM` of every recorded point — so there is no
 * corner anywhere (its curvature is continuous: the wheel turns, it never
 * snaps), and it never strays further from the road than the corridor says.
 *
 * How, in four steps, each linear in the number of fixes:
 *
 * 0. Fixes nearer together than the corridor are one point, their mean — a
 *    town's scatter or a parked phone's cloud is where the road WAS, not a
 *    zigzag to follow.
 * 1. A cubic SMOOTHING SPLINE over the line's own length (Reinsch's
 *    algorithm, one pentadiagonal system for both coordinates), each fix
 *    weighted by the stretch of road it stands for, so a town's dense fixes
 *    and the highway's sparse ones are smoothed at the same scale —
 *    `smoothM`, the shortest wiggle that survives.
 * 2. A fix that reaches out from where its two neighbours put it further
 *    than they are apart, alone, and that only a burst of speed could have
 *    reached, is a GPS error and is left out (the spike `despike` lets
 *    through: a few hundred metres out and back).
 * 3. Every fix still outside the corridor pulls harder (its weight grows with
 *    how far out it is) until the curve passes within `withinM` of it: tight
 *    where the road turns, free where the fixes only scatter.
 * 4. The curve is sampled finely and thinned (a point when the arc strays
 *    2 m from its chord, turns 4° or runs 2 km),
 *    each point carrying how far along the COUNTED line it lies (`km`), so
 *    the counter counts the road and never the shortcut.
 *
 * Computed in a conformal frame (Mercator, in km), whose local scale changes
 * the two terms of the fit alike, so the corridor stays round at any
 * latitude; a piece crossing the antimeridian is unwrapped first. Pure and
 * DOM-free; the trip's year is a few tens of milliseconds.
 */

import type { RoadFix } from './road-track';

export interface RibbonSettings {
  /** The corridor: the ribbon passes within this many metres of every fix it keeps. */
  withinM: number;
  /** The smoothing scale, metres: wiggles shorter than this are ironed out. */
  smoothM: number;
}

const R_KM = 6371.0088;
const RAD = Math.PI / 180;
/** Two fixes nearer than this are one point to the fit (km). */
const MERGE_KM = 0.003;
/** A fix stands for at least this much road, at most this much (km) — a weight's floor and ceiling. */
const SHARE_MIN_KM = 0.01;
const SHARE_MAX_KM = 5;
/** The two ends are the piece's own: pinned by a weight nothing else reaches. */
const PIN = 1e7;
/**
 * An ERROR is a fix this far from where its two neighbours put it (× the
 * corridor, and at least this many km), further than they are from each
 * other, while theirs are under `OUTLIER_ALONE` of its own — AND that only
 * a burst of speed could have reached and left (`HURRY` × the neighbouring
 * stretches' own): a dead end driven to its tip with one fix there (a cape,
 * a lookout) has every other mark of a spike, but the vehicle got there at
 * road speed. A fitted curve cannot tell — the spike stretches the line's
 * own length, so the curve follows it — and sparse fixes cannot either: the
 * middle fix of a highway bend sits as far from its neighbours' chord as a
 * 400 m error does, so such an error is KEPT, a smooth bulge rather than a
 * bend the ribbon would cut.
 */
const OUTLIER_TIMES = 4;
const OUTLIER_MIN_KM = 0.3;
const OUTLIER_ALONE = 0.6;
const HURRY = 1.8;
/** The scale the fixes' scatter is judged at: a 2 km wavelength (λ in km⁴). */
const PROBE_LAMBDA = (2 / (2 * Math.PI)) ** 4;
/** The corridor never narrows below this many times the fixes' local scatter… */
const NOISE_TIMES = 2;
/** …measured over this many knots each side. */
const NOISE_SPAN = 6;
/** How many times the corridor pulls before the ribbon is taken as it is. */
const PULLS = 40;
/** The curve is sampled at most this far apart (km)… */
const SAMPLE_KM = 0.25;
/** …and finely enough that a step turns at most this much (radians), before it is thinned. */
const SAMPLE_RAD = (1 * Math.PI) / 180;
/**
 * The keep rule: a point once the curve strays this far from the chord since
 * the last one, turns this much, or runs this far — finer than the
 * steering's (5 m, 10°), since a polygon's corners are exactly the twitch the
 * ribbon exists to remove.
 */
const KEEP_M = 2;
const KEEP_RAD = (4 * Math.PI) / 180;
const KEEP_KM = 2;

/**
 * One piece of road as a ribbon: the smoothest curve within `withinM` of
 * every fix of `piece`, starting and ending on the piece's own ends. `counted`
 * is the line the kilometres are read on (the piece at the trip's detail, a
 * subsequence of `piece` — `simplify` keeps the very objects); absent, the
 * piece itself. Each point's `km` is how far along that line it lies.
 */
export function ribbonRoad(piece: readonly RoadFix[], settings: RibbonSettings, counted?: readonly RoadFix[]): RoadFix[] {
  const n = piece.length;
  const kmOf = countedKm(piece, counted);
  if (n < 3) return piece.map((f, i) => ({ t: f.t, lat: f.lat, lon: f.lon, km: kmOf[i] }));
  const corridor = Math.max(0.001, settings.withinM / 1000);

  // --- the knots: fixes nearer than the corridor are one point, their mean ------
  let knots = consensus(piece, unwrapped(piece), kmOf, corridor);
  if (knots.length < 3) return straight(piece, kmOf);

  // λ of the fit: its half-power wavelength is the smoothing scale.
  const lambda = (Math.max(1, settings.smoothM) / 1000 / (2 * Math.PI)) ** 4;

  // --- the noise, and the errors ---------------------------------------------------
  // The scatter is judged against a curve of a fixed, modest scale whatever
  // the author's smoothing: under a very smooth one every bend is scatter.
  const probe = fitSpline(knots, null, Math.min(lambda, PROBE_LAMBDA));
  // Where the fixes scatter wider than the corridor (a town's urban canyon, a
  // weak signal), the corridor widens to that scatter: no fix can say where
  // the road was more precisely than its own noise, and holding to each one
  // there is the zigzag the ribbon exists to remove.
  let within = localCorridor(probe.residual, corridor);
  const loo = leaveOneOut(knots);
  const dropped = new Set<number>();
  for (let k = 1; k < knots.length - 1; k++) {
    const r = loo[k];
    if (r <= Math.max(OUTLIER_TIMES * within[k], OUTLIER_MIN_KM) || loo[k - 1] >= OUTLIER_ALONE * r || loo[k + 1] >= OUTLIER_ALONE * r) continue;
    if (r > groundKm(knots[k - 1].lat, knots[k - 1].lon, knots[k + 1].lat, knots[k + 1].lon) && hurried(knots, k)) dropped.add(k);
  }
  if (dropped.size && knots.length - dropped.size >= 3) {
    knots = knots.filter((_, k) => !dropped.has(k));
    within = within.filter((_, k) => !dropped.has(k));
  }
  let fit = fitSpline(knots, null, lambda);

  // --- the corridor: what is outside pulls until it is inside ---------------------
  let pull: Float64Array | null = null;
  for (let round = 0; round < PULLS; round++) {
    let out = false;
    for (let k = 0; k < knots.length && !out; k++) out = fit.residual[k] > within[k] * 1.02;
    if (!out) break;
    pull ??= new Float64Array(knots.length).fill(1);
    for (let k = 0; k < knots.length; k++) {
      const r = fit.residual[k] / within[k];
      if (r > 1) pull[k] = Math.min(1e6, pull[k] * Math.min(100, Math.max(2, r * r)));
    }
    fit = fitSpline(knots, pull, lambda);
  }

  return sampleRibbon(piece, knots, fit, kmOf);
}

/**
 * The corridor at each knot: the author's, or twice the fixes' own scatter
 * around them where that is wider — the median distance off a modest curve
 * over a dozen neighbours, so one bend never widens it, a noisy stretch does.
 */
function localCorridor(residual: Float64Array, corridor: number): number[] {
  const n = residual.length;
  const out: number[] = new Array(n);
  const window: number[] = [];
  for (let k = 0; k < n; k++) {
    window.length = 0;
    for (let j = Math.max(0, k - NOISE_SPAN); j <= Math.min(n - 1, k + NOISE_SPAN); j++) window.push(residual[j]);
    window.sort((a, b) => a - b);
    out[k] = Math.max(corridor, NOISE_TIMES * window[window.length >> 1]);
  }
  return out;
}

/**
 * How far each knot lies from where its two neighbours put it at its time
 * (km): a GPS spike is far from it while they are near theirs, however
 * sparse the fixes — a curve fitted through them would pass by the spike.
 */
function leaveOneOut(knots: readonly Knot[]): Float64Array {
  const n = knots.length;
  const out = new Float64Array(n);
  for (let k = 1; k < n - 1; k++) {
    const a = knots[k - 1];
    const b = knots[k];
    const c = knots[k + 1];
    const w = c.t > a.t ? Math.min(1, Math.max(0, (b.t - a.t) / (c.t - a.t))) : 0.5;
    out[k] = groundKm(a.lat + (c.lat - a.lat) * w, a.lon + (c.lon - a.lon) * w, b.lat, b.lon);
  }
  return out;
}

/**
 * Whether reaching knot `k` and leaving it took a burst of speed: its two
 * stretches together, against the stretches either side of them that do not
 * touch it. Without a clock to read (equal times, or no stretch beside), it
 * says no — a fix is never dropped on a guess.
 */
function hurried(knots: readonly Knot[], k: number): boolean {
  const a = knots[k - 1];
  const b = knots[k];
  const c = knots[k + 1];
  if (!(c.t > a.t)) return false;
  const via = (groundKm(a.lat, a.lon, b.lat, b.lon) + groundKm(b.lat, b.lon, c.lat, c.lon)) / (c.t - a.t);
  const speeds: number[] = [];
  const speed = (p: Knot, q: Knot) => {
    if (q.t > p.t) speeds.push(groundKm(p.lat, p.lon, q.lat, q.lon) / (q.t - p.t));
  };
  if (k >= 2) speed(knots[k - 2], a);
  if (k + 2 < knots.length) speed(c, knots[k + 2]);
  if (!speeds.length) return false;
  return via > HURRY * Math.max(...speeds);
}

/** A point of the fit: a fix, or the mean of fixes nearer together than the corridor. */
interface Knot {
  t: number;
  lat: number;
  /** Unwrapped across the antimeridian. */
  lon: number;
  /** On the counted line. */
  km: number;
}

/**
 * The fixes as the fit takes them: a run of fixes within the corridor of the
 * run's first is ONE point, at their mean — a town's scatter, a stay's
 * cloud, a phone that kept writing while parked — so the corridor holds to
 * where the road was, not to each fix's noise around it. The piece's two
 * ends stay its own.
 */
function consensus(piece: readonly RoadFix[], lonOf: Float64Array, kmOf: Float64Array, corridor: number): Knot[] {
  const n = piece.length;
  const out: Knot[] = [{ t: piece[0].t, lat: piece[0].lat, lon: lonOf[0], km: kmOf[0] }];
  let i = 1;
  while (i < n - 1) {
    let j = i;
    let t = 0;
    let lat = 0;
    let lon = 0;
    let km = 0;
    while (j < n - 1 && (j === i || groundKm(piece[i].lat, lonOf[i], piece[j].lat, lonOf[j]) <= corridor)) {
      t += piece[j].t;
      lat += piece[j].lat;
      lon += lonOf[j];
      km += kmOf[j];
      j++;
    }
    const k = j - i;
    const knot = { t: t / k, lat: lat / k, lon: lon / k, km: km / k };
    const prev = out[out.length - 1];
    if (groundKm(prev.lat, prev.lon, knot.lat, knot.lon) >= MERGE_KM) out.push(knot);
    i = j;
  }
  const last = { t: piece[n - 1].t, lat: piece[n - 1].lat, lon: lonOf[n - 1], km: kmOf[n - 1] };
  const prev = out[out.length - 1];
  // The piece's own end wins over a knot that would sit on it.
  if (out.length > 1 && groundKm(prev.lat, prev.lon, last.lat, last.lon) < MERGE_KM) out[out.length - 1] = last;
  else out.push(last);
  return out;
}

// --- the fit -------------------------------------------------------------------------

interface SplineFit {
  /** Arc length at each knot (km, on the ground). */
  s: Float64Array;
  /** The curve's values and second derivatives at each knot, in Mercator km. */
  gx: Float64Array;
  gy: Float64Array;
  cx: Float64Array;
  cy: Float64Array;
  /** How far each knot's fix lies from the curve, on the ground (km). */
  residual: Float64Array;
}

function mercY(lat: number): number {
  const phi = Math.max(-85, Math.min(85, lat)) * RAD;
  return R_KM * Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

function latOfMercY(y: number): number {
  return (2 * Math.atan(Math.exp(y / R_KM)) - Math.PI / 2) / RAD;
}

/** Mercator km per ground km at a latitude. */
function scaleAt(lat: number): number {
  return 1 / Math.cos(Math.max(-85, Math.min(85, lat)) * RAD);
}

function groundKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The piece's longitudes made continuous across the antimeridian. */
function unwrapped(piece: readonly RoadFix[]): Float64Array {
  const out = new Float64Array(piece.length);
  let shift = 0;
  out[0] = piece[0].lon;
  for (let i = 1; i < piece.length; i++) {
    const d = piece[i].lon - piece[i - 1].lon;
    if (d > 180) shift -= 360;
    else if (d < -180) shift += 360;
    out[i] = piece[i].lon + shift;
  }
  return out;
}

/**
 * The weighted cubic smoothing spline through the knots (Reinsch, as in Green
 * & Silverman §2.3): minimise Σ wᵢ |pᵢ − g(sᵢ)|² + λ ∫ |g″|² ds, solved as
 * (R + λ QᵀW⁻¹Q) γ = Qᵀp then g = p − λ W⁻¹Qγ — one pentadiagonal system
 * factored once for the two coordinates.
 */
function fitSpline(knots: readonly Knot[], pull: Float64Array | null, lambda: number): SplineFit {
  const n = knots.length;
  const s = new Float64Array(n);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const scale = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const f = knots[k];
    px[k] = f.lon * RAD * R_KM;
    py[k] = mercY(f.lat);
    scale[k] = scaleAt(f.lat);
    if (k) s[k] = s[k - 1] + Math.max(MERGE_KM, groundKm(knots[k - 1].lat, knots[k - 1].lon, f.lat, f.lon));
  }
  const h = new Float64Array(n - 1);
  for (let k = 0; k < n - 1; k++) h[k] = s[k + 1] - s[k];
  // Each fix weighs the road it stands for, so the smoothing scale is the same
  // in a town's dense fixes as on the highway's sparse ones.
  const iw = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (k === 0 || k === n - 1) {
      iw[k] = 1 / PIN;
      continue;
    }
    const share = Math.min(SHARE_MAX_KM, Math.max(SHARE_MIN_KM, (s[k + 1] - s[k - 1]) / 2));
    iw[k] = 1 / (share * (pull ? pull[k] : 1));
  }

  // The interior knots 1 … n−2 are the unknowns 0 … n−3.
  const m = n - 2;
  const d0 = new Float64Array(m);
  const d1 = new Float64Array(Math.max(0, m - 1));
  const d2 = new Float64Array(Math.max(0, m - 2));
  const bx = new Float64Array(m);
  const by = new Float64Array(m);
  const a = (j: number) => 1 / h[j - 1];
  const c = (j: number) => 1 / h[j];
  const b = (j: number) => -a(j) - c(j);
  for (let j = 1; j <= n - 2; j++) {
    const q = j - 1;
    d0[q] = (h[j - 1] + h[j]) / 3 + lambda * (a(j) ** 2 * iw[j - 1] + b(j) ** 2 * iw[j] + c(j) ** 2 * iw[j + 1]);
    if (j + 1 <= n - 2) d1[q] = h[j] / 6 + lambda * (b(j) * a(j + 1) * iw[j] + c(j) * b(j + 1) * iw[j + 1]);
    if (j + 2 <= n - 2) d2[q] = lambda * c(j) * a(j + 2) * iw[j + 1];
    bx[q] = (px[j + 1] - px[j]) / h[j] - (px[j] - px[j - 1]) / h[j - 1];
    by[q] = (py[j + 1] - py[j]) / h[j] - (py[j] - py[j - 1]) / h[j - 1];
  }
  const solve = factorBand(d0, d1, d2);
  const gammaX = solve(bx);
  const gammaY = solve(by);
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  for (let q = 0; q < m; q++) {
    cx[q + 1] = gammaX[q];
    cy[q + 1] = gammaY[q];
  }
  // g = p − λ W⁻¹ Q γ; (Qγ)ᵢ gathers the three interior knots around i.
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  const residual = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let qx = 0;
    let qy = 0;
    if (i + 1 <= n - 2) {
      qx += a(i + 1) * cx[i + 1];
      qy += a(i + 1) * cy[i + 1];
    }
    if (i >= 1 && i <= n - 2) {
      qx += b(i) * cx[i];
      qy += b(i) * cy[i];
    }
    if (i - 1 >= 1) {
      qx += c(i - 1) * cx[i - 1];
      qy += c(i - 1) * cy[i - 1];
    }
    gx[i] = px[i] - lambda * iw[i] * qx;
    gy[i] = py[i] - lambda * iw[i] * qy;
    residual[i] = Math.hypot(gx[i] - px[i], gy[i] - py[i]) / scale[i];
  }
  return { s, gx, gy, cx, cy, residual };
}

/**
 * LDLᵀ of a symmetric positive definite pentadiagonal matrix (diagonal `d0`,
 * first and second super-diagonals `d1`, `d2`), handed back as a solver.
 */
function factorBand(d0: Float64Array, d1: Float64Array, d2: Float64Array): (rhs: Float64Array) => Float64Array {
  const m = d0.length;
  const D = new Float64Array(m);
  const l1 = new Float64Array(m);
  const l2 = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    if (i >= 2) l2[i] = d2[i - 2] / D[i - 2];
    if (i >= 1) l1[i] = (d1[i - 1] - (i >= 2 ? l2[i] * l1[i - 1] * D[i - 2] : 0)) / D[i - 1];
    D[i] = d0[i] - (i >= 1 ? l1[i] ** 2 * D[i - 1] : 0) - (i >= 2 ? l2[i] ** 2 * D[i - 2] : 0);
  }
  return (rhs) => {
    const x = new Float64Array(m);
    for (let i = 0; i < m; i++) x[i] = rhs[i] - (i >= 1 ? l1[i] * x[i - 1] : 0) - (i >= 2 ? l2[i] * x[i - 2] : 0);
    for (let i = 0; i < m; i++) x[i] /= D[i];
    for (let i = m - 1; i >= 0; i--) x[i] -= (i + 1 < m ? l1[i + 1] * x[i + 1] : 0) + (i + 2 < m ? l2[i + 2] * x[i + 2] : 0);
    return x;
  };
}

// --- the kilometres ------------------------------------------------------------------

/**
 * How far along the counted line each fix of the piece lies: a kept fix at
 * its own distance, one between two kept fixes shared by the piece's own
 * length between them.
 */
export function countedKm(piece: readonly RoadFix[], counted?: readonly RoadFix[]): Float64Array {
  const n = piece.length;
  const out = new Float64Array(n);
  const along = new Float64Array(n);
  for (let i = 1; i < n; i++) along[i] = along[i - 1] + groundKm(piece[i - 1].lat, piece[i - 1].lon, piece[i].lat, piece[i].lon);
  if (!counted || counted.length < 2) return along;
  const at = new Map<RoadFix, number>();
  piece.forEach((f, i) => at.set(f, i));
  const kept: number[] = [];
  const keptKm: number[] = [];
  let km = 0;
  for (let k = 0; k < counted.length; k++) {
    const i = at.get(counted[k]);
    if (k) km += groundKm(counted[k - 1].lat, counted[k - 1].lon, counted[k].lat, counted[k].lon);
    if (i !== undefined && (!kept.length || i > kept[kept.length - 1])) {
      kept.push(i);
      keptKm.push(km);
    }
  }
  // Not a subsequence of the piece (a caller's own line): the piece's own length.
  if (kept.length < 2 || kept[0] !== 0 || kept[kept.length - 1] !== n - 1) return along;
  for (let k = 0; k < kept.length - 1; k++) {
    const i0 = kept[k];
    const i1 = kept[k + 1];
    const span = along[i1] - along[i0];
    for (let i = i0; i <= i1; i++) out[i] = keptKm[k] + (span > 0 ? ((along[i] - along[i0]) / span) * (keptKm[k + 1] - keptKm[k]) : 0);
  }
  return out;
}

function straight(piece: readonly RoadFix[], kmOf: Float64Array): RoadFix[] {
  const a = piece[0];
  const b = piece[piece.length - 1];
  return [
    { t: a.t, lat: a.lat, lon: a.lon, km: kmOf[0] },
    { t: b.t, lat: b.lat, lon: b.lon, km: kmOf[piece.length - 1] },
  ];
}

// --- the sampling ------------------------------------------------------------------------

/**
 * The curve sampled and thinned by the keep rule, back on the globe, each
 * point with its time (shared along the knots) and its counted kilometres.
 * A cubic's bend is largest at its knots (its second derivative is linear
 * between them), so each interval is stepped finely enough for that bend to
 * turn at most `SAMPLE_RAD` per step, and no further than `SAMPLE_KM`: a
 * straight highway costs a few steps a kilometre, a hairpin a few a metre.
 * The two ends are the piece's own.
 */
function sampleRibbon(piece: readonly RoadFix[], knots: readonly Knot[], fit: SplineFit, kmOf: Float64Array): RoadFix[] {
  const { s, gx, gy, cx, cy } = fit;
  const n = knots.length;
  const first = piece[0];
  const last = piece[piece.length - 1];
  const out: RoadFix[] = [{ t: first.t, lat: first.lat, lon: first.lon, km: kmOf[0] }];
  let prevX = gx[0];
  let prevY = gy[0];
  let dirX = 0;
  let dirY = 0;
  let turned = 0;
  let since = 0;
  for (let k = 0; k < n - 1; k++) {
    const h = s[k + 1] - s[k];
    // Mercator km to ground km over this interval.
    const ground = 1 / ((scaleAt(knots[k].lat) + scaleAt(knots[k + 1].lat)) / 2);
    const bend = Math.max(Math.hypot(cx[k], cy[k]), Math.hypot(cx[k + 1], cy[k + 1]));
    const steps = Math.max(1, Math.ceil(h / SAMPLE_KM), Math.ceil((h * bend) / SAMPLE_RAD));
    const t0 = knots[k].t;
    const t1 = knots[k + 1].t;
    const km0 = knots[k].km;
    const km1 = knots[k + 1].km;
    for (let step = 1; step <= steps; step++) {
      const u = (h * step) / steps;
      const v = h - u;
      const x = (u * gx[k + 1] + v * gx[k]) / h - ((u * v) / 6) * ((1 + u / h) * cx[k + 1] + (1 + v / h) * cx[k]);
      const y = (u * gy[k + 1] + v * gy[k]) / h - ((u * v) / 6) * ((1 + u / h) * cy[k + 1] + (1 + v / h) * cy[k]);
      const ex = x - prevX;
      const ey = y - prevY;
      const len = Math.hypot(ex, ey);
      if (len > 0) {
        if (dirX || dirY) {
          const cross = dirX * ey - dirY * ex;
          const dot = dirX * ex + dirY * ey;
          // A step turns little: its sine is its angle, until it is not.
          turned += dot > 0 && Math.abs(cross) < 0.2 * len ? Math.abs(cross) / len : Math.abs(Math.atan2(cross, dot));
        }
        dirX = ex / len;
        dirY = ey / len;
        since += len * ground;
      }
      prevX = x;
      prevY = y;
      if (k === n - 2 && step === steps) break;
      // An arc of length L turned by θ strays about L·θ/8 from its chord.
      if ((since * turned) / 8 >= KEEP_M / 1000 || turned >= KEEP_RAD || since >= KEEP_KM) {
        const w = u / h;
        out.push({
          t: t0 + (t1 - t0) * w,
          lat: latOfMercY(y),
          lon: wrapLon(x / R_KM / RAD),
          km: km0 + (km1 - km0) * w,
        });
        turned = 0;
        since = 0;
      }
    }
  }
  out.push({ t: last.t, lat: last.lat, lon: last.lon, km: kmOf[piece.length - 1] });
  return out;
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
