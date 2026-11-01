/**
 * The story map drawn from a trip of Trips (pure): its ROAD — the GPS track
 * imported from Polarsteps, read in the trip's own mode — as the route, and
 * the places where a stage starts or ends as the towns named along it. The
 * maintainer's pick (2026-10-31): stage ends by default, his own ticks later.
 * Nothing here is content of the public code: the trip lives in his browser.
 */
import { lineKm, roadPieces, simplify, tripRoadFixes, tripRoadLine } from '../roadtrip/road-track';
import type { TripDoc, TripPlace } from '../roadtrip/trip-types';
import type { Stop } from './geo';
import { dayText, type Lang } from './locale';
import { groupName, groupStops, type NamedTown } from '../roadtrip/hooks/stop-clusters';
import type { MapStopRef } from './story-script';
import { mapNamesOf, nameLines, type MapNames, type NamedPoint } from './map-names';

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

/** Unix seconds at a day's start and end, UTC (the trip's days are calendar days). */
const dayStart = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const dayEnd = (iso: string) => dayStart(iso) + 86_400;

const dayLabel = (iso: string, lang: Lang = 'fr'): string => dayText(iso, lang);

/** Which points of a trip the map names: where each stage starts and ends, where each starts, or every place. */
export type MapPoints = 'ends' | 'starts' | 'places';
/** What a named point said before the two lines (`map-names.ts`): read as the matching preset. */
export type MapLabel = 'place' | 'stage' | 'place-date' | 'none';

/** What a series chooses about its map (`ScriptSources.trip.stages` and `.map`). */
export interface MapChoice {
  /** Stage ids kept; absent = every stage. */
  stages?: readonly string[];
  points?: MapPoints;
  label?: MapLabel;
  /** What each point says (`map-names.ts`); absent, `label`'s preset, else the town and its state's code. */
  names?: MapNames;
  /** The language its days are written in. */
  lang?: Lang;
  /** The author's own stops, in visiting order: present, they are the map's points (`ScriptSources.map.stops`). */
  stops?: readonly MapStopRef[];
  /** Nearby stops drawn as one halt, `km` apart at most (Trips' rules, `stop-clusters.ts`). */
  group?: { km: number; visits?: 'consecutive' | 'all'; name?: 'town' | 'first' | 'central' };
  /** The town index when it is at hand, so a group can take the name of the biggest town near it. */
  towns?: readonly NamedTown[] | null;
  /**
   * The recorded road drawn: from the fix nearest the first stop to the one nearest the last (`stops`), or all of
   * it. Unset, it is `stops` for the author's own list and `all` otherwise — a map made before keeps its road.
   */
  route?: 'stops' | 'all';
}

type Stage = TripDoc['stages'][number];

/** A stage as said out loud: its own name, else « first → last » of its places. */
export const stageLabel = (stage: Stage): string =>
  stage.name.trim() ||
  [stage.places[0]?.name, stage.places[stage.places.length - 1]?.name].filter((n, i, a) => n && a.indexOf(n) === i).join(' → ');

/** The stages kept, in date order. */
export function chosenStages(trip: TripDoc, choice: MapChoice = {}): Stage[] {
  return trip.stages
    .filter((s) => !choice.stages || choice.stages.includes(s.id))
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * The towns the map names, in the order they were lived, as `choice` says:
 * by default where each kept stage starts or ends (the maintainer's pick), a
 * town that ends one stage and starts the next named once.
 */
function pickedPlaces(trip: TripDoc, choice: MapChoice) {
  const points = choice.points ?? 'ends';
  const picked: { name: string; lon: number; lat: number; date: string; stage: Stage; place: TripPlace }[] = [];
  for (const stage of chosenStages(trip, choice)) {
    const placed = stage.places.filter((p) => p.coords);
    if (!placed.length) continue;
    const chosen =
      points === 'places'
        ? placed.map((p, i) => [p, i === placed.length - 1 && i > 0 ? stage.endDate : stage.startDate] as const)
        : points === 'starts' || placed.length === 1
          ? [[placed[0], stage.startDate] as const]
          : [[placed[0], stage.startDate] as const, [placed[placed.length - 1], stage.endDate] as const];
    for (const [place, date] of chosen) {
      const last = picked[picked.length - 1];
      if (last && last.name === place.name) continue;
      picked.push({ name: place.name, lon: place.coords!.lon, lat: place.coords!.lat, date, stage, place });
    }
  }
  return picked;
}

/** The towns `tripStops` would name, as stops a series can take over and edit (`ScriptSources.map.stops`). */
export function derivedStops(trip: TripDoc, choice: MapChoice = {}): MapStopRef[] {
  return pickedPlaces(trip, choice).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, day: p.date }));
}

/** Every located place of the trip, every stage, in the order lived — what the big map offers as rings. */
export function tripPlaces(trip: TripDoc): (MapStopRef & { id: string })[] {
  const out: (MapStopRef & { id: string })[] = [];
  for (const stage of chosenStages(trip, {})) {
    const placed = stage.places.filter((p) => p.coords);
    placed.forEach((p, i) =>
      out.push({ id: p.id, name: p.name, lat: p.coords!.lat, lon: p.coords!.lon, day: i === placed.length - 1 && i > 0 ? stage.endDate : stage.startDate }),
    );
  }
  return out;
}

/** The trip's named points as the map's names read them: each place with its stage and day. */
function placedPoints(trip: TripDoc, choice: MapChoice): NamedPoint[] {
  return pickedPlaces(trip, choice).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, date: p.date, place: p.place, stage: stageLabel(p.stage) }));
}

/**
 * The author's own stops as the map's names read them. A stop keeps no id of
 * the trip, so the trip's place it stands for is found by position (within
 * 3 km, its own name preferred) — what gives it a state, a code and a stage.
 */
function ownPoints(choice: MapChoice, trip: TripDoc | null): NamedPoint[] {
  const known = trip ? chosenStages(trip, {}).flatMap((stage) => stage.places.filter((p) => p.coords).map((place) => ({ place, stage }))) : [];
  return (choice.stops ?? []).map((s): NamedPoint => {
    let best: (typeof known)[number] | null = null;
    let bestKm = 3;
    for (const k of known) {
      const c = k.place.coords!;
      const km = Math.hypot((c.lat - s.lat) * 111, (c.lon - s.lon) * 111 * Math.cos((s.lat * Math.PI) / 180)) - (k.place.name === s.name ? 1 : 0);
      if (km < bestKm) {
        bestKm = km;
        best = k;
      }
    }
    return { name: s.name, lat: s.lat, lon: s.lon, date: s.day, own: s.own, place: best?.place ?? null, stage: best ? stageLabel(best.stage) : undefined };
  });
}

/** Points `km` apart at most drawn as one, on the member nearest their middle, named by the first or that one. */
function groupPoints(points: readonly NamedPoint[], group: MapChoice['group'], towns: readonly NamedTown[] | null): NamedPoint[] {
  if (!group || !(group.km > 0) || points.length < 2) return points.slice();
  return groupStops(points, group.km, group.visits ?? 'consecutive').map((g): NamedPoint => {
    const at = points[g.anchor];
    if (g.members.length < 2) return at;
    // The halt's day is the first visit's: the order the map tells it in. Its name is the group's.
    return { ...at, name: groupName(points, g, group.name ?? 'first', towns), date: points[g.members[0]].date, own: undefined };
  });
}

/** Kilometres of the drawn road to each point: where the road passes closest to it, searched forward. */
function withKm(points: readonly NamedPoint[], road: readonly { lat: number; lon: number }[]): NamedPoint[] {
  if (road.length < 2) return points.slice();
  const cum = [0];
  for (let i = 1; i < road.length; i++) cum.push(cum[i - 1] + lineKm([road[i - 1], road[i]]));
  let from = 0;
  return points.map((p) => {
    let best = from;
    let bestD = Infinity;
    const k = Math.cos((p.lat * Math.PI) / 180);
    for (let i = from; i < road.length; i++) {
      const d = ((road[i].lon - p.lon) * k) ** 2 + (road[i].lat - p.lat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    from = best;
    return { ...p, km: cum[best] };
  });
}

/** Points as the map draws them: what each says (two lines), where, its day, its own name. */
function stopsOf(points: readonly NamedPoint[], choice: MapChoice, trip: TripDoc | null): Stop[] {
  const lines = nameLines(points, mapNamesOf(choice), { trip, towns: choice.towns ?? null, lang: choice.lang });
  return points.map((p, i): Stop => [lines[i][0], p.lon, p.lat, p.date ? dayLabel(p.date, choice.lang) : '', lines[i][1], p.name]);
}

/** The trip's named points, as the map says them. */
export function tripStops(trip: TripDoc, choice: MapChoice = {}): Stop[] {
  return stopsOf(placedPoints(trip, choice), choice, trip);
}

/** The author's own stops, as the map says them — what the trip knows of each found by position when it is given. */
export function ownStops(choice: MapChoice, trip: TripDoc | null = null): Stop[] {
  return stopsOf(ownPoints(choice, trip), choice, trip);
}

/** Stops `km` apart at most drawn as one (`groupPoints` for a trip's points), their first line the group's. */
export function groupedStops(stops: readonly Stop[], group: MapChoice['group'], towns: readonly NamedTown[] | null = null): Stop[] {
  if (!group || !(group.km > 0) || stops.length < 2) return stops.slice();
  const pts = stops.map(([name, lon, lat]) => ({ name, lat, lon }));
  return groupStops(pts, group.km, group.visits ?? 'consecutive').map((g): Stop => {
    const at = stops[g.anchor];
    const first = stops[g.members[0]];
    if (g.members.length < 2) return at;
    return [groupName(pts, g, group.name ?? 'first', towns), at[1], at[2], first[3], '', at[5]];
  });
}

/** The places where a stage starts or ends — `tripStops` with its defaults. */
export function stageEndStops(trip: TripDoc): Stop[] {
  return tripStops(trip);
}

/** The trip's road as the map draws it: its mode's pieces, simplified to the map's scale, in one line. */
export function tripRoadPoints(trip: TripDoc, choice: MapChoice = {}): [number, number][] {
  return tripRoadFixesForMap(trip, choice).map((f): [number, number] => [f.lon, f.lat]);
}

/** Unix seconds a kept stage covers, its first day's start to its last day's end. */
function stageWindows(trip: TripDoc, choice: MapChoice): [number, number][] | null {
  if (!choice.stages) return null;
  return chosenStages(trip, choice).map((s) => [dayStart(s.startDate), dayEnd(s.endDate)]);
}

function tripRoadFixesForMap(trip: TripDoc, choice: MapChoice = {}) {
  const road = trip.road;
  if (!road || road.mode === 'crow') return [];
  const tolerance = Math.max(MAP_DETAIL_M, road.detail);
  const windows = stageWindows(trip, choice);
  const fixes = tripRoadFixes(road).filter((f) => !windows || windows.some(([a, b]) => f.t >= a && f.t < b));
  return roadPieces(fixes, road.mode).flatMap((piece) => simplify(piece, tolerance));
}

/** The map of a trip as a series chooses it, or null when it has neither a road nor two named points to draw. */
export function tripMap(trip: TripDoc, choice: MapChoice = {}): TripMap | null {
  const listed = choice.stops ? ownPoints(choice, trip) : placedPoints(trip, choice);
  const all = tripRoadFixesForMap(trip, choice);
  const ends: Stop[] = listed.map((p) => [p.name, p.lon, p.lat, '']);
  const fixes = (choice.route ?? (choice.stops ? 'stops' : 'all')) === 'stops' ? clipToStops(all, ends) : all;
  const road = fixes.map((f): [number, number] => [f.lon, f.lat]);
  const times = fixes.map((f) => f.t);
  // Grouped, then reached along the drawn road (the km field), then said.
  const stops = stopsOf(withKm(groupPoints(listed, choice.group, choice.towns ?? null), fixes), choice, trip);
  if (road.length < 2) return stops.length >= 2 ? { road: [], times: [], stops } : null;
  if (stops.length >= 2) return { road, times, stops };
  // A road with no named stage ends still starts and ends somewhere: two unnamed dots, never the placeholder's.
  const [a, b] = [road[0], road[road.length - 1]];
  return { road, times, stops: [['', a[0], a[1], ''], ['', b[0], b[1], '']] };
}

/**
 * The road from the fix nearest the first stop to the fix nearest the last one after it, in recorded order — so
 * a stopover the author took off the list (a flight in, a country after) leaves the drawn road too. Fewer than
 * two stops, or a road too short, is left whole.
 */
export function clipToStops<F extends { lat: number; lon: number }>(fixes: readonly F[], stops: readonly Stop[]): F[] {
  if (stops.length < 2 || fixes.length < 2) return fixes.slice();
  const nearest = (lon: number, lat: number, from: number) => {
    let best = from;
    let bestD = Infinity;
    const k = Math.cos((lat * Math.PI) / 180);
    for (let i = from; i < fixes.length; i++) {
      const d = ((fixes[i].lon - lon) * k) ** 2 + (fixes[i].lat - lat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const [, lon0, lat0] = stops[0];
  const [, lon1, lat1] = stops[stops.length - 1];
  const a = nearest(lon0, lat0, 0);
  const b = nearest(lon1, lat1, a);
  return b > a ? fixes.slice(a, b + 1) : fixes.slice();
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
export function tripFacts(trip: TripDoc, choice: MapChoice = {}): Record<string, number> {
  const stages = chosenStages(trip, choice);
  // The kept stages' road, counted as recorded; every stage = the trip's own line.
  const km = !trip.road
    ? 0
    : choice.stages
      ? roadPieces(tripRoadFixesForMap(trip, { stages: choice.stages }), trip.road.mode).reduce((n, p) => n + lineKm(p), 0)
      : tripRoadLine(trip.road).km;
  const names = new Set(stages.flatMap((s) => s.places.map((p) => p.name)).filter(Boolean));
  return {
    ...(km > 0 ? { 'trip.km': Math.round(km) } : {}),
    'trip.stages': stages.length,
    'trip.places': names.size,
  };
}


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
