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
 * A flight (over 200 km/h between two fixes, and over 50 km) is never road:
 * the line is cut there and the hop is drawn as the opener always drew it.
 * Pure and DOM-free; the encoding keeps a year of fixes in tens of kilobytes.
 */

export interface RoadFix {
  /** Unix seconds. */
  t: number;
  lat: number;
  lon: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export type RoadMode = 'crow' | 'stages' | 'moves' | 'raw';
export const ROAD_MODES: readonly RoadMode[] = ['crow', 'stages', 'moves', 'raw'];

/** The detail choices, a tolerance in metres; 0 keeps every point the mode kept. */
export const ROAD_DETAILS: readonly number[] = [0, 25, 50, 100, 250, 500, 1000, 2000];
export const DEFAULT_ROAD_DETAIL = 100;
export const DEFAULT_ROAD_MODE: RoadMode = 'stages';

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
  pieces: RoadFix[][];
  /** Points kept, over every piece. */
  points: number;
  km: number;
}

export const NO_ROAD: RoadLine = { pieces: [], points: 0, km: 0 };

export function roadLine(fixes: readonly RoadFix[], mode: RoadMode, detailM: number): RoadLine {
  if (mode === 'crow' || fixes.length < 2) return NO_ROAD;
  let line = cleanFixes(fixes);
  if (mode !== 'raw') line = thin(despike(line), NOISE_KM);
  if (mode === 'stages') line = withoutStays(line);
  const pieces = cutFlights(line).map((p) => simplify(p, detailM));
  return {
    pieces,
    points: pieces.reduce((n, p) => n + p.length, 0),
    km: pieces.reduce((n, p) => n + lineKm(p), 0),
  };
}

// --- a hop on the road -----------------------------------------------------------------

/** Where the last hop left the road: the piece and the fix, so the next hop searches on from there. */
export interface RoadCursor {
  piece: number;
  index: number;
}

export interface RoadHop {
  /** The road's points between the two stops, the stops themselves excluded. */
  via: LatLon[];
  /** The hop's length along the road, stop to stop. */
  km: number;
  cursor: RoadCursor;
}

/** One visit of the road near a point: the closest fix of each run within `snap`. */
function visits(piece: readonly RoadFix[], p: LatLon, snap: number): number[] {
  const out: number[] = [];
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < piece.length; i++) {
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
  const via = piece.slice(i, j + 1).map((f) => ({ lat: f.lat, lon: f.lon }));
  return { via, km: lineKm([a, ...via, b]), cursor };
}

/** Fixes from the parsed Polarsteps track (`polarsteps.ts`'s `PolarstepsFix`, unix seconds). */
export function fixesFrom(track: readonly { lat: number; lon: number; time: number }[]): RoadFix[] {
  return cleanFixes(track.map((f) => ({ t: f.time, lat: f.lat, lon: f.lon })));
}
