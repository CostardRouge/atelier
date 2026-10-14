/**
 * A trip's ROAD (2026-10-09): the GPS track recorded beside the cameras — a
 * Polarsteps export today — kept on the trip and read back as the line the
 * vehicle drives, beside the PLACES it tells. A place is named, shown, halted
 * at; a road point is none of these: it only gives the road its shape, the
 * camera its path and the counter its kilometres.
 *
 * The maintainer's four ways to read it (`RoadMode`), measured on his year in
 * Australia:
 *
 * - `crow`   — no road: the curves from place to place, as before (≈ 14 000 km);
 * - `stages` — the road between stays: what happens during a stay (18 h or
 *   more within 15 km — walks, buses, the commute) is taken out (≈ 20 900 km);
 * - `moves`  — every move, without the GPS's noise: a fix that jumps away and
 *   straight back is dropped, and so is one within 500 m of the last kept;
 * - `raw`    — every fix as recorded.
 *
 * And a DETAIL, apart from the mode: a Douglas–Peucker tolerance in metres,
 * so the author decides how many points the line keeps, not which.
 *
 * And a DRIVE, apart from both (`RoadDrive`): how the vehicle follows the
 * line — point to point, a driver aiming ahead (`steerRoad`), or the ribbon,
 * the smoothest line within a corridor of every fix (`road-ribbon.ts`).
 *
 * A flight (over 200 km/h between two fixes, and over 50 km) is never road:
 * the line is cut there and the hop is drawn as the opener always drew it.
 * Pure and DOM-free; the encoding keeps a year of fixes in tens of kilobytes.
 */

import { ribbonRoad } from './road-ribbon';

export interface RoadFix {
  /** Unix seconds. */
  t: number;
  lat: number;
  lon: number;
  /**
   * On a DRIVEN line (`steerRoad`, `ribbonRoad`) only: how far along the line as recorded
   * this point lies, km from its piece's start — what the counter reads, so
   * a bend the vehicle rounds counts the road and not the shortcut.
   */
  km?: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** A point of a hop on the road; `km` as `RoadFix.km`, on a steered line. */
export interface RoadPoint extends LatLon {
  km?: number;
}

export type RoadMode = 'crow' | 'stages' | 'moves' | 'raw';
export const ROAD_MODES: readonly RoadMode[] = ['crow', 'stages', 'moves', 'raw'];

/** The detail choices, a tolerance in metres; 0 keeps every point the mode kept. */
export const ROAD_DETAILS: readonly number[] = [0, 25, 50, 100, 250, 500, 1000, 2000];
export const DEFAULT_ROAD_DETAIL = 100;
export const DEFAULT_ROAD_MODE: RoadMode = 'stages';

/**
 * How the vehicle STEERS along the road (2026-10-09, his pick of option B
 * in the road-tremor lab): it aims at the point `lookM` metres ahead on the
 * recorded line and turns toward it no tighter than `radiusM` — a driver,
 * not a pen through every fix. The settings of `RoadDrive`'s `driver` style.
 */
export interface RoadSteer {
  lookM: number;
  radiusM: number;
}

/** The look-ahead choices, metres. */
export const ROAD_LOOKS: readonly number[] = [200, 300, 500, 750, 1000, 1500, 2000, 3000];
/** The tightest-turn choices, metres. */
export const ROAD_RADII: readonly number[] = [10, 25, 50, 100, 200, 300, 500];

/** A stored `steer` (before `drive`, 2026-10-09 → 2026-10-13); null for junk. */
export function readRoadSteer(value: unknown): RoadSteer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const look = typeof v.lookM === 'number' && ROAD_LOOKS.includes(v.lookM) ? v.lookM : null;
  if (look === null) return null;
  const radius = typeof v.radiusM === 'number' && ROAD_RADII.includes(v.radiusM) ? v.radiusM : DEFAULT_ROAD_DRIVE.radiusM;
  return { lookM: look, radiusM: radius };
}

/**
 * How the vehicle DRIVES the line the mode and the detail read (2026-10-13,
 * his report that the driver «flotte et tremblote» and his ask to switch
 * between the lab's options):
 *
 * - `fixes`  — point to point: straight from fix to fix, as recorded;
 * - `driver` — the lab's B (`steerRoad`): aims `lookM` ahead, turns no
 *   tighter than `radiusM`; calm, but it cuts bends by hundreds of metres;
 * - `ribbon` — the lab's A, made local (`ribbonRoad`): the smoothest line
 *   within `withinM` of every fix, ironing out wiggles under `smoothM`.
 *
 * Every style's settings are kept side by side, so switching back and forth
 * loses nothing. What is COUNTED never depends on the drive: the kilometres
 * are the line's as the mode and the detail read it.
 */
export type RoadDriveStyle = 'fixes' | 'driver' | 'ribbon';
export const ROAD_DRIVE_STYLES: readonly RoadDriveStyle[] = ['fixes', 'driver', 'ribbon'];

export interface RoadDrive extends RoadSteer {
  style: RoadDriveStyle;
  /** The ribbon's corridor, metres (`ROAD_WITHINS`). */
  withinM: number;
  /** The ribbon's smoothing scale, metres (`ROAD_SMOOTHS`). */
  smoothM: number;
}

/** The ribbon's corridor choices, metres. */
export const ROAD_WITHINS: readonly number[] = [25, 50, 75, 100, 150, 250, 500];
/** The ribbon's smoothing choices, metres. */
export const ROAD_SMOOTHS: readonly number[] = [500, 1000, 2000, 3000, 5000, 10000, 20000];

/**
 * How a road drives until the author says otherwise: the ribbon at 100 m /
 * 3 km — measured on the road-tremor lab's synthetic road (five draws, GPS
 * noise 20–80 m), the gentlest steering of every setting tried, ≈ 64 m from
 * the true road on average, and never further from the fixes than the
 * corridor (or their own scatter), where the driver strayed 270 m in
 * `moves` and, before its guard, kilometres in `raw`. Under 3 km the
 * sparse fixes of a highway leave gentle waves; over it, real bends start
 * hugging the corridor's edge.
 */
export const DEFAULT_ROAD_DRIVE: RoadDrive = { style: 'ribbon', lookM: 500, radiusM: 50, withinM: 100, smoothM: 3000 };

/** The line as recorded, nothing driven — for a reader that only counts (`roadLine`). */
export const AS_RECORDED: RoadDrive = { ...DEFAULT_ROAD_DRIVE, style: 'fixes' };

export function isRoadDriveStyle(value: unknown): value is RoadDriveStyle {
  return typeof value === 'string' && (ROAD_DRIVE_STYLES as readonly string[]).includes(value);
}

/** A stored `drive`, each setting on its default where it is junk; undefined for no drive at all. */
export function readRoadDrive(value: unknown): RoadDrive | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (!isRoadDriveStyle(v.style)) return undefined;
  const pick = (x: unknown, list: readonly number[], fallback: number) => (typeof x === 'number' && list.includes(x) ? x : fallback);
  return {
    style: v.style,
    lookM: pick(v.lookM, ROAD_LOOKS, DEFAULT_ROAD_DRIVE.lookM),
    radiusM: pick(v.radiusM, ROAD_RADII, DEFAULT_ROAD_DRIVE.radiusM),
    withinM: pick(v.withinM, ROAD_WITHINS, DEFAULT_ROAD_DRIVE.withinM),
    smoothM: pick(v.smoothM, ROAD_SMOOTHS, DEFAULT_ROAD_DRIVE.smoothM),
  };
}

/** How a stored road drives: its own choice, else the default (`DEFAULT_ROAD_DRIVE`). */
export function roadDriveOf(road: Pick<TripRoad, 'drive'> | null | undefined): RoadDrive {
  return road?.drive ?? DEFAULT_ROAD_DRIVE;
}

/** A stay: this long or longer… */
export const STAY_HOURS = 18;
/** …within this radius of where it began. */
export const STAY_KM = 15;
/** `moves`: a fix this close to the last kept one is noise. */
export const NOISE_KM = 0.5;
/** Over this speed between two fixes, and this far, it is a flight. */
export const FLIGHT_KMH = 200;
export const FLIGHT_MIN_KM = 50;
/** A stop further than this from the road is not on it: the hop keeps its curve. */
export const SNAP_KM = 25;

export function isRoadMode(value: unknown): value is RoadMode {
  return typeof value === 'string' && (ROAD_MODES as readonly string[]).includes(value);
}

export function readRoadDetail(value: unknown): number {
  return typeof value === 'number' && ROAD_DETAILS.includes(value) ? value : DEFAULT_ROAD_DETAIL;
}

const R_KM = 6371.0088;
const RAD = Math.PI / 180;

export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineKm(points: readonly LatLon[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += distanceKm(points[i - 1], points[i]);
  return km;
}

// --- the encoding ------------------------------------------------------------------
//
// Three streams — seconds, latitude and longitude at 1e-5° (about a metre) —
// each delta-coded and written with the polyline algorithm's characters
// ('?'..'~'), joined by a space, which that alphabet never uses.

function encodeInts(values: readonly number[]): string {
  let out = '';
  let prev = 0;
  for (const v of values) {
    let d = v - prev;
    prev = v;
    // Arithmetic, never bitwise: a first timestamp is past 2^31.
    d = d < 0 ? -2 * d - 1 : 2 * d;
    while (d >= 32) {
      out += String.fromCharCode(32 + (d % 32) + 63);
      d = Math.floor(d / 32);
    }
    out += String.fromCharCode(d + 63);
  }
  return out;
}

function decodeInts(text: string): number[] | null {
  const out: number[] = [];
  let prev = 0;
  let i = 0;
  while (i < text.length) {
    let shift = 1;
    let d = 0;
    let c: number;
    do {
      if (i >= text.length) return null;
      c = text.charCodeAt(i++) - 63;
      if (c < 0 || c > 63) return null;
      d += (c % 32) * shift;
      shift *= 32;
    } while (c >= 32);
    const v = d % 2 === 1 ? -(d + 1) / 2 : d / 2;
    prev += v;
    out.push(prev);
  }
  return out;
}

export function encodeTrack(fixes: readonly RoadFix[]): string {
  return [
    encodeInts(fixes.map((f) => Math.round(f.t))),
    encodeInts(fixes.map((f) => Math.round(f.lat * 1e5))),
    encodeInts(fixes.map((f) => Math.round(f.lon * 1e5))),
  ].join(' ');
}

/** The fixes of an encoded track; an empty list for junk, never a throw. */
export function decodeTrack(text: unknown): RoadFix[] {
  if (typeof text !== 'string' || !text) return [];
  const parts = text.split(' ');
  if (parts.length !== 3) return [];
  const [t, lat, lon] = parts.map(decodeInts);
  if (!t || !lat || !lon || t.length !== lat.length || t.length !== lon.length) return [];
  return t.map((s, i) => ({ t: s, lat: lat[i] / 1e5, lon: lon[i] / 1e5 }));
}

/** In time order, one fix per second, positions on the globe only. */
export function cleanFixes(fixes: readonly RoadFix[]): RoadFix[] {
  const ok = fixes.filter(
    (f) =>
      Number.isFinite(f.t) && Number.isFinite(f.lat) && Number.isFinite(f.lon) &&
      Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180,
  );
  ok.sort((a, b) => a.t - b.t);
  const out: RoadFix[] = [];
  for (const f of ok) if (!out.length || Math.round(out[out.length - 1].t) !== Math.round(f.t)) out.push(f);
  return out;
}

// --- the filters ---------------------------------------------------------------------

/** A fix that jumps away and comes straight back (within two hours) is noise. */
export function despike(fixes: readonly RoadFix[]): RoadFix[] {
  if (fixes.length < 3) return [...fixes];
  const out: RoadFix[] = [fixes[0]];
  for (let i = 1; i < fixes.length - 1; i++) {
    const a = out[out.length - 1];
    const b = fixes[i];
    const c = fixes[i + 1];
    const out_ = distanceKm(a, b) + distanceKm(b, c);
    const direct = distanceKm(a, c);
    if ((c.t - a.t) / 3600 < 2 && out_ > 3 * direct + 2) continue;
    out.push(b);
  }
  out.push(fixes[fixes.length - 1]);
  return out;
}

/** Drop every fix within `km` of the last one kept; the last fix always stays. */
export function thin(fixes: readonly RoadFix[], km: number): RoadFix[] {
  if (fixes.length < 3) return [...fixes];
  const out: RoadFix[] = [fixes[0]];
  for (let i = 1; i < fixes.length - 1; i++) if (distanceKm(out[out.length - 1], fixes[i]) > km) out.push(fixes[i]);
  out.push(fixes[fixes.length - 1]);
  return out;
}

/**
 * The fixes outside the stays: a run that stays within `km` of where it began
 * for `hours` or more keeps its first and last fix, and loses what lies
 * between — the town walked, the bus taken, the commute.
 */
export function withoutStays(fixes: readonly RoadFix[], km = STAY_KM, hours = STAY_HOURS): RoadFix[] {
  const out: RoadFix[] = [];
  let i = 0;
  while (i < fixes.length) {
    let j = i;
    while (j + 1 < fixes.length && distanceKm(fixes[i], fixes[j + 1]) <= km) j++;
    if ((fixes[j].t - fixes[i].t) / 3600 >= hours) {
      out.push(fixes[i]);
      if (j > i) out.push(fixes[j]);
      i = j + 1;
    } else {
      out.push(fixes[i]);
      i++;
    }
  }
  return out;
}

/** Douglas–Peucker at `toleranceM` metres, in a local flat frame per run. */
export function simplify(fixes: readonly RoadFix[], toleranceM: number): RoadFix[] {
  if (toleranceM <= 0 || fixes.length < 3) return [...fixes];
  const eps = toleranceM / 1000;
  const lat0 = fixes.reduce((s, f) => s + f.lat, 0) / fixes.length;
  const kx = 111.32 * Math.cos(lat0 * RAD);
  const xy = fixes.map((f) => [f.lon * kx, f.lat * 110.57] as const);
  const keep = new Uint8Array(fixes.length);
  keep[0] = keep[fixes.length - 1] = 1;
  const stack: [number, number][] = [[0, fixes.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let at = -1;
    for (let m = a + 1; m < b; m++) {
      const [px, py] = xy[m];
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > best) {
        best = d;
        at = m;
      }
    }
    if (best > eps) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return fixes.filter((_, i) => keep[i]);
}

/** Cut the fixes where they fly; every piece keeps at least two fixes. */
export function cutFlights(fixes: readonly RoadFix[]): RoadFix[][] {
  const out: RoadFix[][] = [];
  let run: RoadFix[] = [];
  for (let i = 0; i < fixes.length; i++) {
    if (run.length) {
      const prev = run[run.length - 1];
      const km = distanceKm(prev, fixes[i]);
      const hours = (fixes[i].t - prev.t) / 3600;
      if (km > FLIGHT_MIN_KM && (hours <= 0 || km / hours > FLIGHT_KMH)) {
        if (run.length > 1) out.push(run);
        run = [];
      }
    }
    run.push(fixes[i]);
  }
  if (run.length > 1) out.push(run);
  return out;
}

/** The road as a mode reads it: pieces of line, cut at flights. Empty on `crow`. */
export interface RoadLine {
  /** As drawn and driven — steered or a ribbon when the trip drives so (`RoadDrive`). */
  pieces: RoadFix[][];
  /** Points the mode and the detail kept, over every piece, before any driving. */
  points: number;
  /** Kilometres of the line as recorded: the drive never changes what is counted. */
  km: number;
}

export const NO_ROAD: RoadLine = { pieces: [], points: 0, km: 0 };

export function roadLine(fixes: readonly RoadFix[], mode: RoadMode, detailM: number, drive: RoadDrive | null = null): RoadLine {
  if (mode === 'crow' || fixes.length < 2) return NO_ROAD;
  const whole = roadPieces(fixes, mode);
  return driveLine(whole, whole.map((p) => simplify(p, detailM)), drive);
}

/**
 * The fixes a mode keeps, cut at the flights: the road before any detail —
 * what the ribbon reads, and what the Road pane's map dots. Empty on `crow`.
 */
export function roadPieces(fixes: readonly RoadFix[], mode: RoadMode): RoadFix[][] {
  if (mode === 'crow' || fixes.length < 2) return [];
  let line = cleanFixes(fixes);
  if (mode !== 'raw') line = thin(despike(line), NOISE_KM);
  if (mode === 'stages') line = withoutStays(line);
  return cutFlights(line);
}

/**
 * The line a drive makes of a mode's pieces (`whole`) and the same pieces at
 * the trip's detail (`counted`, what is counted) — `roadLine`'s last step,
 * apart so a reader holding the pieces (the Road pane's worker) gets the very
 * line `tripRoadLine` would.
 */
export function driveLine(whole: readonly RoadFix[][], counted: readonly RoadFix[][], drive: RoadDrive | null): RoadLine {
  if (!whole.length) return NO_ROAD;
  const style = drive?.style ?? 'fixes';
  return {
    pieces:
      style === 'driver'
        ? counted.map((p) => steerRoad(p, drive!))
        : style === 'ribbon'
          ? // The ribbon reads EVERY fix the mode kept: Douglas–Peucker keeps a
            // bend's noisiest fix and drops its neighbours, which is the one
            // way to make a corridor follow the noise.
            whole.map((p, i) => ribbonRoad(p, drive!, counted[i]))
          : [...counted],
    points: counted.reduce((n, p) => n + p.length, 0),
    km: counted.reduce((n, p) => n + lineKm(p), 0),
  };
}

// --- steering ---------------------------------------------------------------------------

/** Kilometres per degree of latitude, and of longitude at the equator. */
const KM_LAT = 110.574;
const KM_LON = 111.32;
/** How many points of the road ahead the vehicle aims at the mean of. */
const AIM_SAMPLES = 4;
/** A steered point is kept once the curve driven since the last one strays this far from their chord (metres)… */
const STEER_KEEP_M = 5;
/** …or once it has turned this much, so a tight bend stays round close up… */
const STEER_KEEP_RAD = (10 * Math.PI) / 180;
/** …or after this many kilometres of it. */
const STEER_KEEP_KM = 2;
/** Steps without getting on along the line before the vehicle is put back on it. */
const STEER_STALL = 60;

/**
 * One piece of road as a vehicle STEERS it (pure pursuit): from the piece's
 * first point it aims at the point `lookM` metres further along the line as
 * recorded and turns toward it, never tighter than `radiusM`, a step at a
 * time. What the GPS scattered around the road becomes the bend a driver
 * would take; a sharp corner is rounded, a noisy fix half a kilometre out
 * a gentle swerve. Each point says how far along the recorded line the
 * vehicle was (`km`), so the counter counts the road. The two ends are the
 * piece's own; the arithmetic is local around the vehicle, so it holds at
 * any latitude.
 */
export function steerRoad(piece: readonly RoadFix[], steer: RoadSteer): RoadFix[] {
  const n = piece.length;
  if (n < 3) return [...piece];
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + distanceKm(piece[i - 1], piece[i]));
  const total = cum[n - 1];
  if (!(total > 0)) return [...piece];
  const look = Math.max(1e-3, steer.lookM / 1000);
  const radius = Math.max(1e-3, steer.radiusM / 1000);
  // A step is an ARC, so it can be long: a sixth of the look-ahead keeps the
  // aim fresh, and no longer than the radius where the vehicle turns its
  // tightest. A year of road is then a few hundred thousand steps.
  const free = Math.min(0.25, Math.max(0.005, look / 6));
  const tight = Math.min(free, Math.max(0.005, radius));

  // The recorded line at `k` km, searched on from segment `from`.
  const along = (k: number, from: number) => {
    let j = from;
    while (j < n - 2 && cum[j + 1] < k) j++;
    const span = cum[j + 1] - cum[j];
    const w = span > 0 ? Math.min(1, Math.max(0, (k - cum[j]) / span)) : 0;
    const a = piece[j];
    const b = piece[j + 1];
    return { j, t: a.t + (b.t - a.t) * w, lat: a.lat + (b.lat - a.lat) * w, lon: a.lon + (b.lon - a.lon) * w };
  };

  let lat = piece[0].lat;
  let lon = piece[0].lon;
  let kmLon = KM_LON * Math.cos(lat * RAD);
  // East and north of the vehicle, in km.
  const offset = (p: LatLon) => [(p.lon - lon) * kmLon, (p.lat - lat) * KM_LAT] as const;
  const first = offset(along(Math.min(total, look), 0));
  let heading = Math.atan2(first[1], first[0]);
  let seg = 0;
  let done = 0;
  let turned = 0;
  let since = 0;
  let stalled = 0;
  const out: RoadFix[] = [{ t: piece[0].t, lat, lon, km: 0 }];
  const steps = Math.ceil((4 * total) / tight) + 100;
  for (let step = 0; step < steps; step++) {
    // Where the vehicle is on the recorded line: the nearest point ahead of
    // where it was, never behind it, never past what it is aiming at.
    let best = done;
    let bestSeg = seg;
    let bestD = Infinity;
    for (let j = seg; j < n - 1 && cum[j] <= done + look + 2 * free; j++) {
      const [ax, ay] = offset(piece[j]);
      const [bx, by] = offset(piece[j + 1]);
      const ex = bx - ax;
      const ey = by - ay;
      const l2 = ex * ex + ey * ey;
      const u = l2 > 0 ? Math.min(1, Math.max(0, -(ax * ex + ay * ey) / l2)) : 0;
      const d = Math.hypot(ax + u * ex, ay + u * ey);
      const k = Math.max(done, cum[j] + u * (cum[j + 1] - cum[j]));
      if (d < bestD) {
        bestD = d;
        best = k;
        bestSeg = j;
      }
    }
    stalled = best > done + 1e-6 ? 0 : stalled + 1;
    done = best;
    seg = bestSeg;
    // Further off the line than it aims ahead, or no longer getting on along
    // it — an orbit round a stay's cloud, a turn too tight for its radius —
    // it is put back on the line where it stands, headed along it: left to
    // itself it once drove kilometres off the road (the lab's raw, 2026-10-13).
    if (bestD > Math.max(look, 4 * radius) || stalled > STEER_STALL) {
      if (stalled > STEER_STALL) done = Math.min(total, done + look / 2);
      const here = along(done, seg);
      const ahead = along(Math.min(total, done + Math.max(free, 0.01)), here.j);
      lat = here.lat;
      lon = here.lon;
      kmLon = KM_LON * Math.cos(lat * RAD);
      const [hx, hy] = offset(ahead);
      if (hx || hy) heading = Math.atan2(hy, hx);
      seg = here.j;
      stalled = 0;
      if (done >= total) break;
    }
    // What it aims at: the road a look-ahead away, AVERAGED over a look-ahead
    // of it, so a fix scattered to one side is outvoted by its neighbours.
    let tx = 0;
    let ty = 0;
    for (let k = 0; k < AIM_SAMPLES; k++) {
      const [x, y] = offset(along(Math.min(total, done + look * (0.5 + k / (AIM_SAMPLES - 1))), seg));
      tx += x / AIM_SAMPLES;
      ty += y / AIM_SAMPLES;
    }
    const reach = Math.hypot(tx, ty);
    if (done >= total) break;
    if (reach < 0.005) {
      // Aiming at itself — a stay's cloud of fixes averages to where the
      // vehicle stands: look past it. Giving up here drew a straight line
      // from the first stay to the piece's end (raw, 2026-10-13).
      done = Math.min(total, done + look / 2);
      continue;
    }
    const alpha = Math.atan2(Math.sin(Math.atan2(ty, tx) - heading), Math.cos(Math.atan2(ty, tx) - heading));
    const wanted = (2 * Math.sin(alpha)) / reach;
    const curvature = Math.max(-1 / radius, Math.min(1 / radius, wanted));
    // Never past what it aims at: the end of the piece is a point to reach.
    const ds = Math.min(Math.abs(wanted) * radius < 1 ? free : tight, reach);
    const turn = curvature * ds;
    // Along the arc: the chord at the mean heading, as long as the arc's chord.
    const chord = Math.abs(turn) > 1e-9 ? (2 * Math.sin(turn / 2)) / curvature : ds;
    const mid = heading + turn / 2;
    heading += turn;
    lat += (Math.abs(chord) * Math.sin(mid)) / KM_LAT;
    kmLon = KM_LON * Math.cos(lat * RAD);
    lon += (Math.abs(chord) * Math.cos(mid)) / kmLon;
    turned += Math.abs(turn);
    since += ds;
    // An arc of length L turned by θ strays about L·θ/8 from its chord.
    if ((since * turned) / 8 >= STEER_KEEP_M / 1000 || turned >= STEER_KEEP_RAD || since >= STEER_KEEP_KM) {
      out.push({ t: along(done, seg).t, lat, lon, km: done });
      turned = 0;
      since = 0;
    }
  }
  const last = piece[n - 1];
  out.push({ t: last.t, lat: last.lat, lon: last.lon, km: total });
  return out;
}

// --- a hop on the road -----------------------------------------------------------------

/** Where the last hop left the road: the piece and the fix, so the next hop searches on from there. */
export interface RoadCursor {
  piece: number;
  index: number;
}

export interface RoadHop {
  /** The road's points between the two stops, the stops themselves excluded. */
  via: RoadPoint[];
  /** The hop's length along the road, stop to stop. */
  km: number;
  cursor: RoadCursor;
}

/** How many points of a piece one bounding box covers (`visits`). */
const BLOCK = 64;

/**
 * Each block of `BLOCK` points' bounding box (south, north, west, east),
 * kept per piece: a visit skips a block the point is nowhere near, so a stop
 * costs the blocks plus the points around it rather than the whole road — a
 * ribbon's year is a few hundred thousand points and a piece is planned per
 * hop.
 */
function blocksOf(piece: readonly RoadFix[]): Float64Array {
  const known = blocks.get(piece);
  if (known) return known;
  const count = Math.ceil(piece.length / BLOCK);
  const out = new Float64Array(count * 4);
  for (let b = 0; b < count; b++) {
    let south = Infinity;
    let north = -Infinity;
    let west = Infinity;
    let east = -Infinity;
    for (let i = b * BLOCK; i < Math.min(piece.length, (b + 1) * BLOCK); i++) {
      const f = piece[i];
      south = Math.min(south, f.lat);
      north = Math.max(north, f.lat);
      west = Math.min(west, f.lon);
      east = Math.max(east, f.lon);
    }
    out.set([south, north, west, east], b * 4);
  }
  blocks.set(piece, out);
  return out;
}

const blocks = new WeakMap<readonly RoadFix[], Float64Array>();

/** One visit of the road near a point: the closest fix of each run within `snap`. */
function visits(piece: readonly RoadFix[], p: LatLon, snap: number): number[] {
  const out: number[] = [];
  let best = -1;
  let bestD = Infinity;
  const box = blocksOf(piece);
  // The snap in degrees, generous: a block outside it holds no point within it.
  const dLat = (snap / 110) * 1.01;
  const cos = Math.cos(Math.min(89, Math.abs(p.lat) + dLat) * RAD);
  const dLon = cos > 0.01 && Math.abs(p.lon) + snap / (110 * cos) < 180 ? (snap / (110 * cos)) * 1.01 : Infinity;
  for (let b = 0; b * BLOCK < piece.length; b++) {
    const far =
      p.lat < box[b * 4] - dLat || p.lat > box[b * 4 + 1] + dLat || p.lon < box[b * 4 + 2] - dLon || p.lon > box[b * 4 + 3] + dLon;
    if (far) {
      // Every point of the block is outside the snap: a run ends here.
      if (best >= 0) {
        out.push(best);
        best = -1;
        bestD = Infinity;
      }
      continue;
    }
    for (let i = b * BLOCK; i < Math.min(piece.length, (b + 1) * BLOCK); i++) {
      const d = distanceKm(piece[i], p);
      if (d <= snap) {
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      } else if (best >= 0) {
        out.push(best);
        best = -1;
        bestD = Infinity;
      }
    }
  }
  if (best >= 0) out.push(best);
  return out;
}

/**
 * The road from `a` to `b`: the first visit of `a` at or after the cursor,
 * then the first visit of `b` after it on the same piece — so a road driven
 * out and back through one town takes the right pass each time. A hop the
 * road never joins (a stop off it, a flight between, an order the road
 * never drove) is null, and keeps the curve it always had. When the forward
 * search fails, the road driven the other way is tried, for an author's own
 * stops listed against the clock.
 */
export function roadBetween(
  line: RoadLine,
  a: LatLon,
  b: LatLon,
  cursor: RoadCursor | null = null,
  snap = SNAP_KM,
): RoadHop | null {
  const pick = (from: RoadCursor | null): RoadHop | null => {
    for (let p = from?.piece ?? 0; p < line.pieces.length; p++) {
      const piece = line.pieces[p];
      const starts = visits(piece, a, snap).filter((i) => !from || p > from.piece || i >= from.index);
      if (!starts.length) continue;
      const ends = visits(piece, b, snap);
      for (const i of starts) {
        const j = ends.find((e) => e > i);
        if (j === undefined) continue;
        return hopOf(piece, i, j, a, b, { piece: p, index: j });
      }
    }
    return null;
  };
  const forward = pick(cursor) ?? (cursor ? pick(null) : null);
  if (forward) return forward;
  // Against the clock: the same search from b to a, read backwards.
  const back = (() => {
    for (let p = 0; p < line.pieces.length; p++) {
      const piece = line.pieces[p];
      const starts = visits(piece, b, snap);
      const ends = visits(piece, a, snap);
      for (const i of starts) {
        const j = ends.find((e) => e > i);
        if (j === undefined) continue;
        const hop = hopOf(piece, i, j, b, a, { piece: p, index: i });
        return { ...hop, via: hop.via.slice().reverse() };
      }
    }
    return null;
  })();
  return back;
}

function hopOf(piece: readonly RoadFix[], i: number, j: number, a: LatLon, b: LatLon, cursor: RoadCursor): RoadHop {
  const via: RoadPoint[] = piece.slice(i, j + 1).map((f) => (f.km === undefined ? { lat: f.lat, lon: f.lon } : { lat: f.lat, lon: f.lon, km: f.km }));
  return { via, km: roadKms(a, via, b).km, cursor };
}

/**
 * A hop's kilometres on the road, at each of its points and in all: between
 * two points of a steered line, the distance along the line as RECORDED
 * (`RoadPoint.km`), so the bends the vehicle rounds still count; elsewhere
 * point to point. `dist` is the caller's own great-circle measure.
 */
export function roadKms(
  a: LatLon,
  via: readonly LatLon[],
  b: LatLon,
  dist: (p: LatLon, q: LatLon) => number = distanceKm,
): { viaKm: number[]; km: number } {
  const viaKm: number[] = [];
  let k = 0;
  let prev: RoadPoint = a;
  for (const p of via as readonly RoadPoint[]) {
    k += prev.km !== undefined && p.km !== undefined ? Math.abs(p.km - prev.km) : dist(prev, p);
    viaKm.push(k);
    prev = p;
  }
  return { viaKm, km: k + dist(prev, b) };
}

/** Fixes from the parsed Polarsteps track (`polarsteps.ts`'s `PolarstepsFix`, unix seconds). */
export function fixesFrom(track: readonly { lat: number; lon: number; time: number }[]): RoadFix[] {
  return cleanFixes(track.map((f) => ({ t: f.time, lat: f.lat, lon: f.lon })));
}

// --- the road on the trip ----------------------------------------------------------------

/**
 * The trip's road (`TripDoc.road`, v32): the whole track, encoded, and how
 * the trip reads it. Portable — the backup carries it, raw fixes included.
 */
/** Where a road's fixes came from: a Polarsteps export, GPX files, or both merged. */
export type RoadSource = 'polarsteps' | 'gpx' | 'mixed';

export function isRoadSource(value: unknown): value is RoadSource {
  return value === 'polarsteps' || value === 'gpx' || value === 'mixed';
}

/** How a source is said on screen. */
export function roadSourceText(source: RoadSource): string {
  return source === 'gpx' ? 'GPX' : source === 'mixed' ? 'Polarsteps and GPX' : 'Polarsteps';
}

export interface TripRoad {
  /** Where the fixes came from. */
  source: RoadSource;
  /** `encodeTrack` of every fix kept, in time order. */
  track: string;
  /** How many fixes the track holds, said without decoding it. */
  fixes: number;
  /** Road points placed by hand where the track has a hole; never named, never a place. */
  added: RoadFix[];
  mode: RoadMode;
  /** The Douglas–Peucker tolerance, metres (`ROAD_DETAILS`). */
  detail: number;
  /**
   * How the vehicle drives the line (`RoadDrive`): absent drives by
   * `DEFAULT_ROAD_DRIVE` — read through `roadDriveOf`, never raw. A road kept
   * with the older `steer` reads as the driver it chose, or point to point
   * where it had turned steering off.
   */
  drive?: RoadDrive;
  /** When the track was last written, ms. */
  importedAt: number;
}

/** A validated read: junk lands as no road, a missing setting on its default. */
export function readTripRoad(raw: unknown): TripRoad | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const fixes = decodeTrack(r.track);
  const added = Array.isArray(r.added)
    ? cleanFixes(
        r.added.filter((f): f is RoadFix => !!f && typeof f === 'object').map((f) => ({ t: Number(f.t), lat: Number(f.lat), lon: Number(f.lon) })),
      )
    : [];
  if (fixes.length < 2 && !added.length) return null;
  // The older `steer` (2026-10-09): null was steering turned off, an object
  // the driver's own settings, absent the default — which is now the ribbon.
  const steer = r.steer === null ? null : readRoadSteer(r.steer);
  const legacy = r.steer === null ? AS_RECORDED : steer ? { ...DEFAULT_ROAD_DRIVE, ...steer, style: 'driver' as const } : undefined;
  const drive = readRoadDrive(r.drive) ?? legacy;
  return {
    source: isRoadSource(r.source) ? r.source : 'polarsteps',
    track: typeof r.track === 'string' ? r.track : '',
    fixes: fixes.length,
    added,
    mode: isRoadMode(r.mode) ? r.mode : DEFAULT_ROAD_MODE,
    detail: readRoadDetail(r.detail),
    // Absent or junk: the default.
    ...(drive ? { drive } : {}),
    importedAt: typeof r.importedAt === 'number' && Number.isFinite(r.importedAt) ? r.importedAt : 0,
  };
}

/**
 * The road a fresh track gives the trip: its fixes within the trip's span
 * (a day of slack each side, for the zones), and the reading the author
 * already chose — a re-import replaces the fixes and keeps the mode, the
 * detail, the drive and the points placed by hand.
 */
export function makeTripRoad(
  fixes: readonly RoadFix[],
  span: { startDate: string; endDate: string },
  previous: TripRoad | null,
  now: number,
  source: RoadSource = 'polarsteps',
): TripRoad | null {
  const kept = withinSpan(cleanFixes(fixes), span);
  if (kept.length < 2) return previous;
  return {
    source,
    track: encodeTrack(kept),
    fixes: kept.length,
    added: previous?.added ?? [],
    mode: previous?.mode ?? DEFAULT_ROAD_MODE,
    detail: previous?.detail ?? DEFAULT_ROAD_DETAIL,
    ...(previous?.drive ? { drive: previous.drive } : {}),
    importedAt: now,
  };
}

/** The fixes within the trip's span, a day of slack each side (for the zones). */
function withinSpan(fixes: readonly RoadFix[], span: { startDate: string; endDate: string }): RoadFix[] {
  const from = Date.parse(`${span.startDate}T00:00:00Z`) / 1000 - 86_400;
  const to = Date.parse(`${span.endDate}T23:59:59Z`) / 1000 + 86_400;
  return fixes.filter((f) => f.t >= from && f.t <= to);
}

/**
 * The road with more fixes MERGED in — a GPX of the days the track missed,
 * a car's log beside a phone's — on the one clock, the same instant once,
 * kept within the trip's span. Creates the road when there is none; the
 * reading and the hand-placed points stay. Null when nothing new lands
 * inside the span (and there was no road).
 */
export function addRoadFixes(
  road: TripRoad | null,
  fixes: readonly RoadFix[],
  span: { startDate: string; endDate: string },
  source: RoadSource,
  now: number,
): { road: TripRoad | null; added: number } {
  const old = road ? decodeTrack(road.track) : [];
  const fresh = withinSpan(cleanFixes(fixes), span);
  const merged = cleanFixes([...old, ...fresh]);
  const added = merged.length - old.length;
  if (added <= 0) return { road, added: 0 };
  const next = makeTripRoad(merged, span, road, now, road && road.source !== source ? 'mixed' : source);
  return { road: next, added: next ? added : 0 };
}

/** The line a trip's road draws, as its mode and detail read it and its drive drives it, hand-placed points merged in time. */
export function tripRoadLine(road: TripRoad | null): RoadLine {
  if (!road || road.mode === 'crow') return NO_ROAD;
  // Every surface that paints a piece asks, often per edit: the same stored
  // road (an edit elsewhere keeps its object) is read once.
  const known = lineOf.get(road);
  if (known) return known;
  const line = roadLine(tripRoadFixes(road), road.mode, road.detail, roadDriveOf(road));
  lineOf.set(road, line);
  return line;
}

/** Every fix of a stored road, the hand-placed points merged in time. */
export function tripRoadFixes(road: TripRoad): RoadFix[] {
  return road.added.length ? cleanFixes([...decodeTrack(road.track), ...road.added]) : decodeTrack(road.track);
}

/**
 * Hand `tripRoadLine` a line computed elsewhere for this very road — the Road
 * panel's worker (`road-line-worker.ts`) — so every surface reading the road
 * once it is written finds it ready instead of computing it again on the
 * main thread. The line MUST be `roadLine` of the same road.
 */
export function primeTripRoadLine(road: TripRoad, line: RoadLine): void {
  if (road.mode !== 'crow') lineOf.set(road, line);
}

const lineOf = new WeakMap<TripRoad, RoadLine>();

/**
 * A hop found on the road that wanders this far past the crow's line is not
 * that hop — the road joined the two stops on two different passes — and
 * keeps its curve. Generous: a road round a bay is 4–5× the water it skirts.
 */
export const DETOUR_RATIO = 8;
const DETOUR_KM = 150;
/**
 * Two stops nearer than this are one place told twice: the vehicle stays,
 * rather than driving the day trip or the commute the road made from there
 * (measured on a real year: four 120 km loops between stops 1 km apart).
 */
export const SAME_PLACE_KM = 3;

/**
 * Each hop of a list of stops along the road, in order, the cursor carried
 * from one to the next (`roadBetween`); null where the road does not join
 * the two, or joins them by an absurd detour. Cached per line and stops,
 * since every reader of a piece plans the same drive.
 */
export function roadHops(line: RoadLine, stops: readonly LatLon[]): (RoadHop | null)[] {
  if (!line.pieces.length || stops.length < 2) return stops.slice(1).map(() => null);
  const key = stops.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';');
  let byStops = hopsOf.get(line);
  if (!byStops) hopsOf.set(line, (byStops = new Map()));
  const known = byStops.get(key);
  if (known) return known;
  const out: (RoadHop | null)[] = [];
  let cursor: RoadCursor | null = null;
  for (let i = 1; i < stops.length; i++) {
    const crow = distanceKm(stops[i - 1], stops[i]);
    if (crow < SAME_PLACE_KM) {
      out.push(null);
      continue;
    }
    const hop = roadBetween(line, stops[i - 1], stops[i], cursor);
    const sane = hop && (hop.km <= crow * DETOUR_RATIO || hop.km - crow <= DETOUR_KM);
    out.push(sane ? hop : null);
    if (sane) cursor = hop.cursor;
  }
  if (byStops.size > 8) byStops.clear();
  byStops.set(key, out);
  return out;
}

const hopsOf = new WeakMap<RoadLine, Map<string, (RoadHop | null)[]>>();
