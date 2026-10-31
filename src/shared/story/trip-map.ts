/**
 * The story map drawn from a trip of Trips (pure): its ROAD — the GPS track
 * imported from Polarsteps, read in the trip's own mode — as the route, and
 * the places where a stage starts or ends as the towns named along it. The
 * maintainer's pick (2026-10-31): stage ends by default, his own ticks later.
 * Nothing here is content of the public code: the trip lives in his browser.
 */
import { roadPieces, simplify, tripRoadFixes } from '../roadtrip/road-track';
import type { TripDoc } from '../roadtrip/trip-types';
import type { Stop } from './geo';

/**
 * The tolerance the road is simplified to, metres. At the story map's widest
 * a pixel is about 2 km of Australia and the camera zooms ×2.3, so a point
 * every kilometre or so of bend is all the line can show; the trip's own
 * detail wins when it is coarser.
 */
export const MAP_DETAIL_M = 1000;

export interface TripMap {
  /** `[lon, lat]` in driven order; empty when the trip has no road (or draws as the crow flies). */
  road: [number, number][];
  stops: Stop[];
}

const dayLabel = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' });

/** The places where a stage starts or ends, in the order they were lived; a town that ends one stage and starts the next is named once. */
export function stageEndStops(trip: TripDoc): Stop[] {
  const stages = trip.stages.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  const out: Stop[] = [];
  for (const stage of stages) {
    const placed = stage.places.filter((p) => p.coords);
    if (!placed.length) continue;
    const ends = placed.length === 1 ? [[placed[0], stage.startDate] as const] : [[placed[0], stage.startDate] as const, [placed[placed.length - 1], stage.endDate] as const];
    for (const [place, date] of ends) {
      const last = out[out.length - 1];
      if (last && last[0] === place.name) continue;
      out.push([place.name, place.coords!.lon, place.coords!.lat, dayLabel(date)]);
    }
  }
  return out;
}

/** The trip's road as the map draws it: its mode's pieces, simplified to the map's scale, in one line. */
export function tripRoadPoints(trip: TripDoc): [number, number][] {
  const road = trip.road;
  if (!road || road.mode === 'crow') return [];
  const tolerance = Math.max(MAP_DETAIL_M, road.detail);
  return roadPieces(tripRoadFixes(road), road.mode).flatMap((piece) =>
    simplify(piece, tolerance).map((f): [number, number] => [f.lon, f.lat]),
  );
}

/** The map of a trip, or null when it has neither a road nor two named stage ends to draw. */
export function tripMap(trip: TripDoc): TripMap | null {
  const road = tripRoadPoints(trip);
  const stops = stageEndStops(trip);
  if (road.length < 2) return stops.length >= 2 ? { road: [], stops } : null;
  if (stops.length >= 2) return { road, stops };
  // A road with no named stage ends still starts and ends somewhere: two unnamed dots, never the placeholder's.
  const [a, b] = [road[0], road[road.length - 1]];
  return { road, stops: [['', a[0], a[1], ''], ['', b[0], b[1], '']] };
}
