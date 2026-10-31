// The brief's route and projection, as in the lab page. The coastline is the v1 project's
// world-atlas land-50m extract (src/data/australia.json, same projection: scripts/gen-australia.mjs),
// finer than the page's 55-point polygon — which matters once the camera zooms ×2.3.
import coast from "./australia.json";

/** A stop on the trip: name, longitude, latitude, the date it is labelled with. */
export type Stop = [string, number, number, string];

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
export function setMap(stops: readonly Stop[] | null | undefined, road: RoadPoints | null | undefined): void {
  const next = stops && stops.length >= 2 ? stops.slice() : PLACEHOLDER_STOPS;
  const line = road && road.length >= 2 ? road : null;
  if (next === STOPS && line === lastRoad && ROUTE.length) return;
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

export function routeAt(f: number): [number, number, number] {
  const d = f * ROUTELEN;
  for (let i = 1; i < ROUTE.length; i++)
    if (d <= ROUTECUM[i]) {
      const k = (d - ROUTECUM[i - 1]) / (ROUTECUM[i] - ROUTECUM[i - 1]);
      return [ROUTE[i - 1][0] + (ROUTE[i][0] - ROUTE[i - 1][0]) * k, ROUTE[i - 1][1] + (ROUTE[i][1] - ROUTE[i - 1][1]) * k, i - 1];
    }
  const p = ROUTE[ROUTE.length - 1];
  return [p[0], p[1], ROUTE.length - 2];
}

let paths: Path2D[] | null = null;
export const coastPaths = () => (paths ??= (coast as { d: string }[]).map((p) => new Path2D(p.d)));

setStops(null);
