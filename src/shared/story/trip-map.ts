/**
 * The story map drawn from a trip of Trips (pure): its ROAD — the GPS track
 * imported from Polarsteps, read in the trip's own mode — as the route, and
 * the places where a stage starts or ends as the towns named along it. The
 * maintainer's pick (2026-10-31): stage ends by default, his own ticks later.
 * Nothing here is content of the public code: the trip lives in his browser.
 */
import { roadPieces, simplify, tripRoadFixes, tripRoadLine } from '../roadtrip/road-track';
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
  /** When each road point was recorded, Unix seconds, aligned with `road` — what places a day on it. */
  times: number[];
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
  return tripRoadFixesForMap(trip).map((f): [number, number] => [f.lon, f.lat]);
}

function tripRoadFixesForMap(trip: TripDoc) {
  const road = trip.road;
  if (!road || road.mode === 'crow') return [];
  const tolerance = Math.max(MAP_DETAIL_M, road.detail);
  return roadPieces(tripRoadFixes(road), road.mode).flatMap((piece) => simplify(piece, tolerance));
}

/** The map of a trip, or null when it has neither a road nor two named stage ends to draw. */
export function tripMap(trip: TripDoc): TripMap | null {
  const fixes = tripRoadFixesForMap(trip);
  const road = fixes.map((f): [number, number] => [f.lon, f.lat]);
  const times = fixes.map((f) => f.t);
  const stops = stageEndStops(trip);
  if (road.length < 2) return stops.length >= 2 ? { road: [], times: [], stops } : null;
  if (stops.length >= 2) return { road, times, stops };
  // A road with no named stage ends still starts and ends somewhere: two unnamed dots, never the placeholder's.
  const [a, b] = [road[0], road[road.length - 1]];
  return { road, times, stops: [['', a[0], a[1], ''], ['', b[0], b[1], '']] };
}

/** The episode with the map's holes put where its `map-holes` blocks leave `gaps` unset. */
export function withGaps<E extends { blocks: { block: string; params?: Record<string, unknown> }[] }>(episode: E, gaps: [number, number][] | null): E {
  if (!gaps) return episode;
  return {
    ...episode,
    blocks: episode.blocks.map((b) => (b.block === 'map-holes' && !Array.isArray(b.params?.gaps) ? { ...b, params: { ...(b.params ?? {}), gaps } } : b)),
  };
}

/** What the trip itself counts, as facts a caption cites: its road's kilometres, its stages, its named places. */
export function tripFacts(trip: TripDoc): Record<string, number> {
  const line = tripRoadLine(trip.road);
  const names = new Set(trip.stages.flatMap((s) => s.places.map((p) => p.name)).filter(Boolean));
  return {
    ...(line.km > 0 ? { 'trip.km': Math.round(line.km) } : {}),
    'trip.stages': trip.stages.length,
    'trip.places': names.size,
  };
}

/** Unix seconds at a day's start and end, UTC (the trip's days are calendar days). */
const dayStart = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const dayEnd = (iso: string) => dayStart(iso) + 86_400;

/**
 * The map's holes as fractions of the drawn route (`map-holes`' `gaps`): each
 * run of unplaced days `[first, last]` is placed where the road was driven on
 * those days, by its fixes' times; without a timed road, by the date's place
 * between the trip's first and last day. A hole of zero length is dropped.
 */
export function gapsOf(holes: readonly (readonly [string, string])[], map: TripMap, span: { from: string; to: string }): [number, number][] {
  const timed = map.road.length >= 2 && map.times.length === map.road.length;
  let cum: number[] = [];
  if (timed) {
    cum = map.road.reduce<number[]>((acc, p, i) => {
      const prev = map.road[i - 1];
      acc.push(i ? acc[i - 1] + Math.hypot(p[0] - prev[0], (p[1] - prev[1]) * 1.2) : 0);
      return acc;
    }, []);
  }
  const total = cum[cum.length - 1] || 0;
  const t0 = dayStart(span.from);
  const t1 = dayEnd(span.to);
  const fracAt = (t: number): number => {
    if (timed && total > 0) {
      const i = map.times.findIndex((x) => x >= t);
      return i < 0 ? 1 : cum[i] / total;
    }
    return t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
  };
  return holes
    .map(([a, b]): [number, number] => [fracAt(dayStart(a)), fracAt(dayEnd(b))])
    .filter(([a, b]) => b > a);
}
