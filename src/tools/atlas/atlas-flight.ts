/**
 * A drone flight as Flight Atlas draws it — the pure half: parsed SRT cues in,
 * a compact track out. No DOM, no map library.
 *
 * The atlas holds every flight of a library at once, so a track is kept the
 * way a renderer wants it rather than the way the parser hands it: one typed
 * array per channel, positions already in Web Mercator WORLD units (`[0, 1]`
 * on both axes, the unit the view's affine maps to pixels), times in CAPTURE
 * seconds from the first fix. A DJI log writes a cue per frame (30–60 a
 * second); four samples a second is far finer than any trail can show and a
 * hundred flights still fit in a few megabytes.
 *
 * The clock comes from the cue's own timestamp line when it has one — that is
 * the capture's wall clock, and it is right on a slow-motion or time-lapse
 * clip where the file's seconds are not. A log without timestamps falls back
 * to the cue times and says nothing about the hour or the day.
 */

import type { Cue } from '../../shared/telemetry/srt-parser';
import { parsePosition } from '../../shared/telemetry/flight-path';

/** One flight, ready to draw. */
export interface AtlasFlight {
  id: string;
  name: string;
  /** Web Mercator world x of each kept fix, `[0, 1]` west → east. */
  xs: Float64Array;
  /** Web Mercator world y of each kept fix, `[0, 1]` north → south. */
  ys: Float64Array;
  /** Capture seconds since the first kept fix. */
  ts: Float32Array;
  /** Height above take-off, metres (0 where the log has none). */
  alts: Float32Array;
  /** Ground speed, m/s, measured over the kept fixes and lightly smoothed. */
  speeds: Float32Array;
  /**
   * Running totals at each kept fix, so a statistic at any instant is one
   * lookup: km flown so far, the time integral of height (m·s — divided by
   * the time it gives the average height), the highest and fastest so far.
   */
  cumKm: Float64Array;
  cumAltS: Float64Array;
  cumMaxAlt: Float32Array;
  cumMaxSpeed: Float32Array;
  /** Capture seconds from the first fix to the last. */
  duration: number;
  /** Ground distance flown, km. */
  distanceKm: number;
  maxAlt: number;
  maxSpeed: number;
  /**
   * The first fix's wall clock, as milliseconds of a UTC calendar READ AS
   * LOCAL time — the log writes the drone's local time with no zone, so this
   * is a wall reading and never an instant. Null when the log has no
   * timestamps.
   */
  startWall: number | null;
  /** Where it took off. */
  lat0: number;
  lon0: number;
  /** World box of the whole track. */
  box: WorldBox;
}

export interface WorldBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Samples closer than this in capture time are merged into one. */
export const KEEP_EVERY_S = 0.25;
/** A jump faster than this between two fixes is a GPS glitch, not flight. */
const GLITCH_MPS = 120;
const EARTH_KM = 6371.0088;
const MAX_LAT = 85.05112878;

/** Longitude → Web Mercator world x. */
export function worldX(lon: number): number {
  return (lon + 180) / 360;
}

/** Latitude → Web Mercator world y (north is 0). */
export function worldY(lat: number): number {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const s = Math.sin((l * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** World x → longitude. */
export function lonOf(x: number): number {
  return x * 360 - 180;
}

/** World y → latitude. */
export function latOf(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/** Great-circle distance, km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?/;

/**
 * A cue's timestamp line as wall-clock milliseconds (a UTC calendar read as
 * local time), or null when it is absent or not a date.
 */
export function parseWall(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const m = STAMP_RE.exec(stamp.trim());
  if (!m) return null;
  const frac = m[7] ? Number(`0.${m[7]}`) * 1000 : 0;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + frac;
  return Number.isFinite(ms) ? ms : null;
}

/** Seconds since midnight of a wall reading. */
export function secondsOfDay(wall: number): number {
  const day = 86_400_000;
  return (((wall % day) + day) % day) / 1000;
}

/** `YYYY-MM-DD` of a wall reading. */
export function dayKey(wall: number): string {
  return new Date(wall).toISOString().slice(0, 10);
}

/**
 * Build a flight from a clip's cues, or null when fewer than two fixes
 * survive (a log with no GPS lock, a hover of one point).
 */
export function flightFromCues(id: string, name: string, cues: readonly Cue[]): AtlasFlight | null {
  // Every located cue, with its capture time.
  const raw: { lat: number; lon: number; wall: number | null; t: number; alt: number }[] = [];
  for (const cue of cues) {
    const pos = parsePosition(cue);
    if (!pos) continue;
    const alt = Number(cue.data.rel_alt);
    raw.push({ lon: pos[0], lat: pos[1], wall: parseWall(cue.timestamp), t: cue.start, alt: Number.isFinite(alt) ? alt : 0 });
  }
  if (raw.length < 2) return null;

  // The wall clock is trusted only when the first and last both have one and
  // it runs forwards: a log whose stamps are missing or garbled keeps the cue
  // times, which are at least monotonic.
  const w0 = raw[0].wall;
  const wN = raw[raw.length - 1].wall;
  const useWall = w0 !== null && wN !== null && wN >= w0;
  const timeOf = (i: number): number => {
    const r = raw[i];
    if (useWall && r.wall !== null) return (r.wall - (w0 as number)) / 1000;
    return r.t - raw[0].t;
  };

  const lat: number[] = [];
  const lon: number[] = [];
  const ts: number[] = [];
  const alts: number[] = [];
  let lastT = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const t = timeOf(i);
    if (!Number.isFinite(t) || t < lastT) continue;
    const isLast = i === raw.length - 1;
    if (t - lastT < KEEP_EVERY_S && !isLast) continue;
    if (lat.length) {
      const k = lat.length - 1;
      const dt = Math.max(1e-3, t - ts[k]);
      const m = haversineKm(lat[k], lon[k], raw[i].lat, raw[i].lon) * 1000;
      if (m / dt > GLITCH_MPS) continue;
      // The last cue may sit closer than the step to the previous one: it
      // replaces it rather than doubling the end of the line.
      if (isLast && t - lastT < KEEP_EVERY_S && lat.length > 1) {
        lat[k] = raw[i].lat;
        lon[k] = raw[i].lon;
        ts[k] = t;
        alts[k] = raw[i].alt;
        lastT = t;
        continue;
      }
    }
    lat.push(raw[i].lat);
    lon.push(raw[i].lon);
    ts.push(t);
    alts.push(raw[i].alt);
    lastT = t;
  }
  const n = lat.length;
  if (n < 2) return null;

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const box: WorldBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < n; i++) {
    const x = worldX(lon[i]);
    const y = worldY(lat[i]);
    xs[i] = x;
    ys[i] = y;
    if (x < box.x0) box.x0 = x;
    if (x > box.x1) box.x1 = x;
    if (y < box.y0) box.y0 = y;
    if (y > box.y1) box.y1 = y;
  }

  // Speed between kept fixes, then a 5-tap mean so a jittery fix does not
  // flash a gradient.
  const step = new Float32Array(n);
  let distanceKm = 0;
  for (let i = 1; i < n; i++) {
    const km = haversineKm(lat[i - 1], lon[i - 1], lat[i], lon[i]);
    distanceKm += km;
    step[i] = (km * 1000) / Math.max(1e-3, ts[i] - ts[i - 1]);
  }
  step[0] = step[1];
  const speeds = new Float32Array(n);
  let maxSpeed = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      sum += step[j];
      count += 1;
    }
    speeds[i] = sum / count;
    if (speeds[i] > maxSpeed) maxSpeed = speeds[i];
  }

  let maxAlt = 0;
  for (const a of alts) if (a > maxAlt) maxAlt = a;

  const cumKm = new Float64Array(n);
  const cumAltS = new Float64Array(n);
  const cumMaxAlt = new Float32Array(n);
  const cumMaxSpeed = new Float32Array(n);
  cumMaxAlt[0] = Math.max(0, alts[0]);
  cumMaxSpeed[0] = speeds[0];
  for (let i = 1; i < n; i++) {
    cumKm[i] = cumKm[i - 1] + haversineKm(lat[i - 1], lon[i - 1], lat[i], lon[i]);
    // Trapezoids: the height held between two fixes, times the time between.
    cumAltS[i] = cumAltS[i - 1] + ((Math.max(0, alts[i - 1]) + Math.max(0, alts[i])) / 2) * (ts[i] - ts[i - 1]);
    cumMaxAlt[i] = Math.max(cumMaxAlt[i - 1], alts[i]);
    cumMaxSpeed[i] = Math.max(cumMaxSpeed[i - 1], speeds[i]);
  }

  return {
    id,
    name,
    xs,
    ys,
    ts: Float32Array.from(ts),
    alts: Float32Array.from(alts),
    speeds,
    cumKm,
    cumAltS,
    cumMaxAlt,
    cumMaxSpeed,
    duration: ts[n - 1],
    distanceKm,
    maxAlt,
    maxSpeed,
    startWall: useWall ? (w0 as number) : null,
    lat0: lat[0],
    lon0: lon[0],
    box,
  };
}

/**
 * The index of the last kept fix at or before `t` capture seconds (binary
 * search), so a trail can be cut at any instant. −1 before the first fix.
 */
export function indexAt(ts: Float32Array, t: number): number {
  if (ts.length === 0 || t < ts[0]) return -1;
  let lo = 0;
  let hi = ts.length - 1;
  if (t >= ts[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The position at `t` capture seconds, interpolated between fixes. */
export function positionAt(f: AtlasFlight, t: number): { x: number; y: number; alt: number; speed: number; i: number } {
  const n = f.ts.length;
  const i = indexAt(f.ts, t);
  if (i < 0) return { x: f.xs[0], y: f.ys[0], alt: f.alts[0], speed: f.speeds[0], i: 0 };
  if (i >= n - 1) return { x: f.xs[n - 1], y: f.ys[n - 1], alt: f.alts[n - 1], speed: f.speeds[n - 1], i: n - 1 };
  const span = f.ts[i + 1] - f.ts[i];
  const k = span > 0 ? (t - f.ts[i]) / span : 0;
  return {
    x: f.xs[i] + (f.xs[i + 1] - f.xs[i]) * k,
    y: f.ys[i] + (f.ys[i + 1] - f.ys[i]) * k,
    alt: f.alts[i] + (f.alts[i + 1] - f.alts[i]) * k,
    speed: f.speeds[i] + (f.speeds[i + 1] - f.speeds[i]) * k,
    i,
  };
}

/** The union of several world boxes, or null for none. */
export function unionBox(boxes: Iterable<WorldBox>): WorldBox | null {
  let out: WorldBox | null = null;
  for (const b of boxes) {
    if (!out) out = { ...b };
    else {
      if (b.x0 < out.x0) out.x0 = b.x0;
      if (b.y0 < out.y0) out.y0 = b.y0;
      if (b.x1 > out.x1) out.x1 = b.x1;
      if (b.y1 > out.y1) out.y1 = b.y1;
    }
  }
  return out;
}
