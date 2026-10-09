/**
 * Points of ROAD placed by hand (`TripRoad.added`), for the stretches the
 * track does not hold: a phone switched off for a day, a drive Polarsteps
 * never logged. Never a place — a road point is driven, not told
 * (`road-track.ts`) — and never named.
 *
 * A point is put on the track's own clock: the click lands on the nearest
 * stretch between two consecutive fixes, and takes the time that far along
 * it, so it merges into the track in order (`tripRoadLine` sorts by time).
 * A flight is no stretch to fill: the vehicle did not drive it.
 *
 * Pure, so the sheet and a test agree.
 */

import {
  FLIGHT_KMH,
  FLIGHT_MIN_KM,
  cleanFixes,
  decodeTrack,
  distanceKm,
  type LatLon,
  type RoadFix,
  type TripRoad,
} from './road-track';

/** A stretch between two fixes this long is a GAP — drawn as one, the obvious place to add a point. */
export const GAP_KM = 20;
/** How far from the nearest stretch a click may land and still be put on it. */
export const REACH_KM = 300;

/** A stretch between two consecutive fixes. */
export interface RoadStretch {
  from: RoadFix;
  to: RoadFix;
  km: number;
}

/** Whether a stretch is a flight: fast and long — the vehicle never drove it. */
function flies(a: RoadFix, b: RoadFix, km: number): boolean {
  const hours = (b.t - a.t) / 3600;
  return km > FLIGHT_MIN_KM && (hours <= 0 || km / hours > FLIGHT_KMH);
}

/** The track with the hand-placed points merged in, in time — what every reading of the road starts from. */
export function roadFixes(road: TripRoad): RoadFix[] {
  const track = decodeTrack(road.track);
  return road.added.length ? cleanFixes([...track, ...road.added]) : track;
}

/** The stretches longer than `minKm` that are not flights: where the road has a hole. */
export function roadGaps(fixes: readonly RoadFix[], minKm = GAP_KM): RoadStretch[] {
  const out: RoadStretch[] = [];
  for (let i = 1; i < fixes.length; i++) {
    const km = distanceKm(fixes[i - 1], fixes[i]);
    if (km > minKm && !flies(fixes[i - 1], fixes[i], km)) out.push({ from: fixes[i - 1], to: fixes[i], km });
  }
  return out;
}

/** The point's distance to the stretch a→b and how far along it its foot is (0–1), on a flat map at their latitude. */
function footOn(p: LatLon, a: LatLon, b: LatLon): { km: number; along: number } {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const ax = a.lon * k;
  const bx = b.lon * k;
  const px = p.lon * k;
  const dx = bx - ax;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  const along = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p.lat - a.lat) * dy) / len2)) : 0;
  const foot = { lat: a.lat + dy * along, lon: (ax + dx * along) / k };
  return { km: distanceKm(p, foot), along };
}

/**
 * The road with a point placed at `p`: on the nearest stretch of the track
 * (a flight excluded) within `reach`, at the time that far along it. Null
 * when no stretch is near enough, or the nearest has no second to spare
 * between its two fixes.
 */
export function placeRoadPoint(road: TripRoad, p: LatLon, reach = REACH_KM): TripRoad | null {
  const fixes = roadFixes(road);
  let best: { a: RoadFix; b: RoadFix; along: number; km: number } | null = null;
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const span = distanceKm(a, b);
    if (flies(a, b, span)) continue;
    const foot = footOn(p, a, b);
    if (foot.km <= reach && (!best || foot.km < best.km)) best = { a, b, along: foot.along, km: foot.km };
  }
  if (!best) return null;
  const { a, b } = best;
  if (b.t - a.t < 2) return null;
  // Strictly between the two fixes, so the merge keeps both.
  const t = Math.min(b.t - 1, Math.max(a.t + 1, Math.round(a.t + (b.t - a.t) * best.along)));
  const point: RoadFix = { t, lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5 };
  return { ...road, added: [...road.added, point].sort((x, y) => x.t - y.t) };
}

/** The hand-placed point nearest `p` within `km`, by its index in `added`; null when none is. */
export function nearestRoadPoint(road: TripRoad, p: LatLon, km: number): number | null {
  let best: number | null = null;
  let bestKm = km;
  road.added.forEach((q, i) => {
    const d = distanceKm(p, q);
    if (d <= bestKm) {
      bestKm = d;
      best = i;
    }
  });
  return best;
}

/** The road without its hand-placed point at `index`. */
export function removeRoadPoint(road: TripRoad, index: number): TripRoad {
  return { ...road, added: road.added.filter((_, i) => i !== index) };
}
