// The brief's route and projection, as in the lab page. The coastline is the v1 project's
// world-atlas land-50m extract (src/data/australia.json, same projection: scripts/gen-australia.mjs),
// finer than the page's 55-point polygon — which matters once the camera zooms ×2.3.
import coast from "./australia.json";
import type { NamedWhich } from "./map-names";
import { paceTable, pacedAt, type RoutePace } from "./route-pace";

/**
 * A stop on the trip: what it says (its first line), longitude, latitude, its
 * day as written, then — optional — its second line (`map-names.ts`) and the
 * place's own name, which a block naming a stop looks it up by.
 */
export type Stop = [string, number, number, string, string?, string?];

/**
 * The trip drawn on the map. It is CONTENT, so it comes from the private
 * script (`story-script.ts`), set by `setStops` before a frame is drawn;
 * without a script the map shows an unnamed line across the continent.
 */
export const PLACEHOLDER_STOPS: Stop[] = [
  ['', 115.86, -31.95, ''],
  ['', 138.6, -34.93, ''],
  ['', 153.03, -27.47, ''],
];
export let STOPS: Stop[] = PLACEHOLDER_STOPS;
export const proj = (lon: number, lat: number): [number, number] => [
  540 + (lon - 133.5) * 23.6 * 0.906,
  900 - (lat + 27) * 23.6,
];
export let ROUTE: [number, number][] = [];
export let ROUTECUM: number[] = [];
export let ROUTELEN = 1;
/** Where each stop sits on the map, and how far along the route (0–1) it is reached. */
export let STOP_XY: [number, number][] = [];
export let STOP_REACH: number[] = [];

/** A road as `[lon, lat]` points, in the order it was driven. */
export type RoadPoints = readonly (readonly [number, number])[];

/** Which stops carry their name as the route is drawn (`map-names.ts`, `namedAt`). */
export let NAMED: NamedWhich = 'all';

/** Point the map at a trip. Two stops at least; fewer keeps the placeholder. */
export function setStops(stops: readonly Stop[] | null | undefined): void {
  setMap(stops, null);
}

let lastRoad: RoadPoints | null = null;

/**
 * Point the map at a trip: the ROUTE is its road when one is given (a trip's
 * GPS track, `trip-map.ts`), else the stops joined in a line; the stops are
 * the towns named along it, each reached where the road passes closest to it
 * — searched forward, so a road that passes a town twice names it in order.
 */
export function setMap(
  stops: readonly Stop[] | null | undefined,
  road: RoadPoints | null | undefined,
  named: NamedWhich = 'all',
  extra: { times?: readonly number[] | null; pace?: RoutePace | null } = {},
): void {
  NAMED = named;
  const given = stops && stops.length >= 2 ? stops : null;
  const line = road && road.length >= 2 ? road : null;
  const times = line && extra.times && extra.times.length === line.length ? extra.times : null;
  const paceKey = JSON.stringify(extra.pace ?? null);
  // The same stops and road as the frame before (compared as GIVEN: a copy is new every time, and the
  // route, its reaches and the camera's track — keyed on ROUTE — were all rebuilt for every frame).
  if (given === lastStops && line === lastRoad && ROUTE.length) {
    if (paceKey !== lastPaceKey || times !== lastTimes) setPaceTable(times, extra.pace ?? null, paceKey);
    return;
  }
  lastStops = given;
  setRoute(given ? given.slice() : PLACEHOLDER_STOPS, line);
  setPaceTable(times, extra.pace ?? null, paceKey);
}

let lastStops: readonly Stop[] | null = null;

let lastPaceKey = '';
let lastTimes: readonly number[] | null = null;
let PACE: Float64Array | null = null;
/** Bumped whenever the pace changes — what a camera baked along the paced route is keyed on. */
export let PACE_VERSION = 0;
/** What marks the tip of the route as it is drawn (`route-pace.ts`). */
export let HEAD: NonNullable<RoutePace['head']> = 'none';
/** The road's times and the series' pace turned into the table `paced` reads (`route-pace.ts`). */
function setPaceTable(times: readonly number[] | null, pace: RoutePace | null, key: string): void {
  lastPaceKey = key;
  lastTimes = times;
  PACE_VERSION += 1;
  HEAD = pace?.head ?? 'none';
  const p = pace ?? {};
  PACE = (p.days ?? 0) > 0 || (p.dwell ?? 0) > 0 ? paceTable(ROUTECUM, times, STOP_REACH, pace) : null;
}

/** The route fraction a block's eased progress `x` reaches, as the series' pace says (distance, days, pauses). */
export const paced = (x: number): number => (PACE ? pacedAt(PACE, x) : x);

function setRoute(next: Stop[], line: RoadPoints | null): void {
  STOPS = next;
  lastRoad = line;
  ROUTE = line ? line.map((p) => proj(p[0], p[1])) : STOPS.map((s) => proj(s[1], s[2]));
  ROUTECUM = ROUTE.reduce<number[]>((acc, p, i) => {
    acc.push(i ? acc[i - 1] + Math.hypot(p[0] - ROUTE[i - 1][0], p[1] - ROUTE[i - 1][1]) : 0);
    return acc;
  }, []);
  ROUTELEN = ROUTECUM[ROUTECUM.length - 1] || 1;
  STOP_XY = STOPS.map((s) => proj(s[1], s[2]));
  if (!line) {
    STOP_REACH = ROUTECUM.map((d) => d / ROUTELEN);
    return;
  }
  let from = 0;
  STOP_REACH = STOP_XY.map(([x, y]) => {
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < ROUTE.length; i++) {
      const d = Math.hypot(ROUTE[i][0] - x, ROUTE[i][1] - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    from = best;
    return ROUTECUM[best] / ROUTELEN;
  });
}

/**
 * The route's point at fraction `f` of its length, and the segment it is on.
 * Found by halving (`ROUTECUM` only grows): a driven line is thousands of
 * points, and a frame asks hundreds of times (`map-holes` walks the route).
 */
export function routeAt(f: number): [number, number, number] {
  const d = f * ROUTELEN;
  const n = ROUTE.length;
  if (d >= ROUTECUM[n - 1]) {
    const p = ROUTE[n - 1];
    return [p[0], p[1], n - 2];
  }
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ROUTECUM[mid] >= d) hi = mid;
    else lo = mid + 1;
  }
  const i = lo;
  const span = ROUTECUM[i] - ROUTECUM[i - 1];
  const k = span > 0 ? (d - ROUTECUM[i - 1]) / span : 0;
  return [ROUTE[i - 1][0] + (ROUTE[i][0] - ROUTE[i - 1][0]) * k, ROUTE[i - 1][1] + (ROUTE[i][1] - ROUTE[i - 1][1]) * k, i - 1];
}

let paths: Path2D[] | null = null;
export const coastPaths = () => (paths ??= (coast as { d: string }[]).map((p) => new Path2D(p.d)));

setStops(null);
