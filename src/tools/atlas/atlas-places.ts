/**
 * PLACES and level of detail for Flight Atlas, pure.
 *
 * A place is the flights that took off near one another — single linkage on
 * the take-off points, so a coastline flown from five spots a kilometre apart
 * is one place while the next town is another. The atlas uses places to
 * frame one spot, to colour by spot and to label the map; their names come
 * from the shipped city index, never a lookup (`AtlasTool`).
 *
 * `simplify` is Douglas–Peucker over world coordinates: a fit-all view of a
 * hundred flights does not need forty thousand vertices a frame, and a
 * tolerance tied to the zoom keeps a line exact to under a pixel.
 */

import { haversineKm, unionBox, type WorldBox } from './atlas-flight';

export interface PlaceInput {
  lat0: number;
  lon0: number;
  box: WorldBox;
}

export interface AtlasPlace {
  /** Stable while the same flights fall in it: the first flight's index. */
  id: string;
  /** Indices of the flights in it, in input order. */
  flights: number[];
  lat: number;
  lon: number;
  box: WorldBox;
}

/** Take-offs closer than this are one place. */
export const PLACE_RADIUS_KM = 4;

/** Group flights into places; the biggest place first. */
export function clusterPlaces(flights: readonly PlaceInput[], radiusKm = PLACE_RADIUS_KM): AtlasPlace[] {
  const n = flights.length;
  const parent = flights.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // A cheap reject before the trigonometry: 0.1° is ≥ 4 km of latitude.
      if (Math.abs(flights[i].lat0 - flights[j].lat0) > radiusKm / 100) continue;
      if (haversineKm(flights[i].lat0, flights[i].lon0, flights[j].lat0, flights[j].lon0) <= radiusKm) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  const places: AtlasPlace[] = [];
  for (const members of groups.values()) {
    const lat = members.reduce((s, i) => s + flights[i].lat0, 0) / members.length;
    const lon = members.reduce((s, i) => s + flights[i].lon0, 0) / members.length;
    places.push({
      id: `p${members[0]}`,
      flights: members,
      lat,
      lon,
      box: unionBox(members.map((i) => flights[i].box)) as WorldBox,
    });
  }
  return places.sort((a, b) => b.flights.length - a.flights.length || a.flights[0] - b.flights[0]);
}

/** Which place each flight belongs to (index into `places`). */
export function placeOfFlight(places: readonly AtlasPlace[], count: number): number[] {
  const out = new Array<number>(count).fill(0);
  places.forEach((p, k) => {
    for (const i of p.flights) out[i] = k;
  });
  return out;
}

/**
 * Douglas–Peucker: the indices of the points kept so that no dropped point
 * lies farther than `tolerance` (world units) from the line kept. The first
 * and last are always kept. Iterative, so a long track cannot overflow the
 * stack.
 */
export function simplify(xs: ArrayLike<number>, ys: ArrayLike<number>, tolerance: number): Uint32Array {
  const n = xs.length;
  if (n <= 2) return Uint32Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    if (b - a < 2) continue;
    const ax = xs[a];
    const ay = ys[a];
    const dx = xs[b] - ax;
    const dy = ys[b] - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      let px = xs[i] - ax;
      let py = ys[i] - ay;
      if (len2 > 0) {
        const k = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        px -= k * dx;
        py -= k * dy;
      }
      const d = px * px + py * py;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(a, best, best, b);
    }
  }
  let count = 0;
  for (let i = 0; i < n; i++) count += keep[i];
  const out = new Uint32Array(count);
  let k = 0;
  for (let i = 0; i < n; i++) if (keep[i]) out[k++] = i;
  return out;
}
