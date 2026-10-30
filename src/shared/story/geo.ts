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

/** Point the map at a trip. Two stops at least; fewer keeps the placeholder. */
export function setStops(stops: readonly Stop[] | null | undefined): void {
  const next = stops && stops.length >= 2 ? stops.slice() : PLACEHOLDER_STOPS;
  if (next === STOPS && ROUTE.length) return;
  STOPS = next;
  ROUTE = STOPS.map((s) => proj(s[1], s[2]));
  ROUTECUM = ROUTE.reduce<number[]>((acc, p, i) => {
    acc.push(i ? acc[i - 1] + Math.hypot(p[0] - ROUTE[i - 1][0], p[1] - ROUTE[i - 1][1]) : 0);
    return acc;
  }, []);
  ROUTELEN = ROUTECUM[ROUTECUM.length - 1] || 1;
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
