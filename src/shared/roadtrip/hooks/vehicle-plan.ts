/**
 * Which vehicle drives each stretch of a Virée's road (2026-10-09, his asks
 * of the vehicle lab): the trip's fleet per stage, a hop picked by hand, and
 * a boat by itself where the road crosses water (`terrain.ts`).
 *
 * The chain, strongest first — the lab's, built:
 *
 * 1. the PIECE forces one vehicle for its whole road (the opener's own
 *    `vehicle` option, a boat borrowed for the day);
 * 2. the PLACE says how it was reached (`TripPlace.arriveBy`): that whole hop;
 * 3. WATER: under the trip's rule (`TripDoc.crossings.auto`), the part of a
 *    hop that crosses it sails — the stage's own vehicle if it is a boat,
 *    else the rule's boat — from the shore it leaves to the shore it reaches;
 * 4. the STAGE the hop arrives in names a vehicle (`TripStage.vehicle`);
 * 5. the TRIP: the vehicle of the piece's day (its stage's, else the main).
 *
 * Then the LOOK: a stretch's reference is read on the day the vehicle is
 * there (`resolveRef`), so the Prado drives green until Melbourne and Raptor
 * black after — the dated changes of `vehicle-fleet.ts`.
 *
 * Everything here is in the plan's own units (`RoadPath`), so the painter asks
 * by the moment's arc length and nothing is measured twice. Pure and DOM-free.
 */

import { hopTerrain, stepKm, type HopTerrain, type LandIndex, type RouteSample } from '../../map/terrain';
import { resolveRef, sameRef, type TripCrossings, type TripVehicle, type VehicleRef } from '../vehicle-fleet';
import { sameVehicleSpec, vehicleKind, type VehicleSpec } from '../vehicle-spec';
import { PLAN_SIZE, type DriveMoment, type DrivePlan, type DriveStop, type PlanPoint, type RoadPath } from './drive-plan';
import type { Projection } from './geo';
import type { HookDay, HookStage } from './hook-variant';

/** Who decided a stretch's vehicle — said in the panel, and what a swap's splash is coloured by. */
export type SegmentSource = 'piece' | 'place' | 'water' | 'stage' | 'trip';

export interface VehicleSegment {
  /** The stretch, in the plan's arc length. */
  s0: number;
  s1: number;
  ref: VehicleRef;
  source: SegmentSource;
}

export interface DriveVehicles {
  segments: VehicleSegment[];
  /** Each hop's terrain, when the water rule read it; null where it did not (no rule, no coastline, a forced vehicle). */
  hops: (HopTerrain | null)[];
}

export interface DriveVehiclesInput {
  stops: readonly DriveStop[];
  path: RoadPath;
  /** The projection the plan was laid out with — to read a sample's latitude and longitude back. */
  geo: Projection;
  /** Half the plan's box: where the projection centred the stops. */
  centre: number;
  stages: readonly HookStage[];
  fleet: readonly TripVehicle[];
  crossings?: TripCrossings;
  land?: LandIndex | null;
  /** What a stop no leg claims drives — the piece's day's vehicle. */
  dayRef: VehicleRef;
  /** A vehicle the piece forces on its whole road; null follows the trip. */
  forced: VehicleRef | null;
}

/** The ground step the hops are sampled at for the coastline, km: under the bridge length and the shore distance. */
const SAMPLE_KM = 1.5;

/** A plan point back to the ground. */
function unproject(p: PlanPoint, geo: Projection, centre: number): { lat: number; lon: number } {
  const x = (p.x - centre) / geo.scale + geo.midX;
  const y = (p.y - centre) / geo.scale + geo.midY;
  return { lon: geo.k > 1e-9 ? x / geo.k : x, lat: -y };
}

/**
 * One hop's samples along the drawn curve, densified to a ground step: the
 * path holds two dozen points per hop, which over a 400 km hop is 17 km —
 * wider than the straits the rule must see.
 */
function hopSamples(path: RoadPath, h: number, geo: Projection, centre: number): RouteSample[] {
  const s0 = path.stopS[h];
  const s1 = path.stopS[h + 1];
  const points: { p: PlanPoint; s: number }[] = [];
  for (let i = 0; i < path.points.length; i++) {
    const s = path.cum[i];
    if (s < s0 - 1e-9 || s > s1 + 1e-9) continue;
    points.push({ p: path.points[i], s });
  }
  const out: RouteSample[] = [];
  let km = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const ga = unproject(a.p, geo, centre);
    if (i === 0) {
      out.push({ ...ga, s: a.s, km: 0 });
      continue;
    }
    const prev = points[i - 1];
    const gp = unproject(prev.p, geo, centre);
    const step = stepKm(gp, ga);
    const n = Math.max(1, Math.ceil(step / SAMPLE_KM));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      const p = { x: prev.p.x + (a.p.x - prev.p.x) * u, y: prev.p.y + (a.p.y - prev.p.y) * u };
      const g = unproject(p, geo, centre);
      km += stepKm(out[out.length - 1], g);
      out.push({ ...g, s: prev.s + (a.s - prev.s) * u, km });
    }
  }
  return out;
}

/**
 * A hop's terrain, remembered per coastline: an opener's `prepare` runs for
 * every slide just to measure it, and a long road's samples are thousands of
 * land tests. The key is everything the samples depend on — every stop (the
 * projection fits them all, and the curve reads a hop's neighbours), the
 * hop, the path's own length and the rule — so a hit is exactly the answer.
 */
const terrainCache = new WeakMap<LandIndex, Map<string, HopTerrain>>();

function cachedTerrain(
  land: LandIndex,
  stops: readonly DriveStop[],
  path: RoadPath,
  h: number,
  input: DriveVehiclesInput,
  rule: TripCrossings,
): HopTerrain {
  let byKey = terrainCache.get(land);
  if (!byKey) terrainCache.set(land, (byKey = new Map()));
  const key = `${h}|${rule.bridgeKm}|${rule.shoreKm}|${path.length.toFixed(4)}|${stops.map((s) => `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`).join(';')}`;
  let found = byKey.get(key);
  if (!found) {
    found = hopTerrain(land, hopSamples(path, h, input.geo, input.centre), rule);
    if (byKey.size > 4000) byKey.clear();
    byKey.set(key, found);
  }
  return found;
}

/** The model a reference names — a fleet vehicle's, or the borrowed one. */
export function refModel(ref: VehicleRef, fleet: readonly TripVehicle[]): string {
  if ('borrow' in ref) return ref.borrow;
  return (fleet.find((v) => v.id === ref.fleet) ?? fleet[0])?.spec.model ?? 'prado-j120';
}

/** The stretches of a road and who drives each. */
export function driveVehicles(input: DriveVehiclesInput): DriveVehicles {
  const { stops, path, stages, fleet, crossings, land, dayRef, forced } = input;
  const hopCount = Math.max(0, stops.length - 1);
  const hops: (HopTerrain | null)[] = Array.from({ length: hopCount }, () => null);
  if (forced || hopCount === 0) {
    const ref = forced ?? dayRef;
    return { segments: [{ s0: 0, s1: path.length, ref, source: forced ? 'piece' : 'trip' }], hops };
  }
  const readsWater = !!(crossings?.auto && land);
  const raw: VehicleSegment[] = [];
  for (let h = 0; h < hopCount; h++) {
    const s0 = path.stopS[h];
    const s1 = path.stopS[h + 1];
    const to = stops[h + 1];
    const placed = to.source?.arriveBy;
    if (placed) {
      raw.push({ s0, s1, ref: placed, source: 'place' });
      continue;
    }
    const stageRef = to.leg !== null ? stages[to.leg]?.vehicle : undefined;
    const landRef: VehicleRef = stageRef ?? dayRef;
    const landSource: SegmentSource = stageRef ? 'stage' : 'trip';
    const terrain = readsWater ? cachedTerrain(land!, stops, path, h, input, crossings!) : null;
    hops[h] = terrain;
    if (!terrain?.water) {
      raw.push({ s0, s1, ref: landRef, source: landSource });
      continue;
    }
    // On the water the stage's own vehicle sails if it is a boat; else the rule's boat.
    const waterRef: VehicleRef = vehicleKind(refModel(landRef, fleet)) === 'boat' ? landRef : { borrow: crossings!.boat };
    const w0 = Math.max(s0, Math.min(s1, terrain.water.s0));
    const w1 = Math.max(w0, Math.min(s1, terrain.water.s1));
    if (w0 > s0) raw.push({ s0, s1: w0, ref: landRef, source: landSource });
    raw.push({ s0: w0, s1: w1, ref: waterRef, source: 'water' });
    if (w1 < s1) raw.push({ s0: w1, s1, ref: landRef, source: landSource });
  }
  // One stretch per run of the same vehicle decided the same way.
  const segments: VehicleSegment[] = [];
  for (const seg of raw) {
    const last = segments[segments.length - 1];
    if (last && sameRef(last.ref, seg.ref) && last.source === seg.source && Math.abs(last.s1 - seg.s0) < 1e-6) last.s1 = seg.s1;
    else segments.push({ ...seg });
  }
  return { segments, hops };
}

/**
 * The stretch at an arc length. At a stop — a boundary — it is the stretch
 * ARRIVING there, so a vehicle halted at Whitehaven is the boat it came by;
 * the very start is the first stretch.
 */
export function segmentAt(segments: readonly VehicleSegment[], s: number): VehicleSegment {
  if (!segments.length) throw new Error('a road with no stretch');
  if (s <= segments[0].s0 + 1e-9) return segments[0];
  for (const seg of segments) if (s <= seg.s1 + 1e-9) return seg;
  return segments[segments.length - 1];
}

/**
 * The calendar day of a moment: the recap's own clock when it runs (a
 * continuous day of the trip), else the stop the vehicle is at — its arrival
 * — or the stop it drives from — its departure; `fallback` (the piece's own
 * day) where nothing dates it.
 */
export function momentDay(
  stops: readonly DriveStop[],
  path: RoadPath,
  s: number,
  clockDay: number | null,
  calendar: readonly HookDay[],
  fallback: string,
): string {
  const dayNumber = clockDay ?? stopDayNumber(stops, path, s);
  if (dayNumber === null) return fallback;
  const n = Math.max(1, Math.floor(dayNumber + 1e-9));
  return calendar.find((d) => d.dayNumber === n)?.date ?? fallback;
}

function stopDayNumber(stops: readonly DriveStop[], path: RoadPath, s: number): number | null {
  let at = 0;
  for (let i = 0; i < path.stopS.length; i++) if (path.stopS[i] <= s + 1e-9) at = i;
  const here = stops[at];
  const onStop = Math.abs(path.stopS[at] - s) < 1e-6;
  if (!here?.days) return null;
  if (onStop) return here.days.arrive;
  // On the road the vehicle has not yet ARRIVED: a leg's span is shared so a
  // place is left the day the next is reached, and a change dated the day it
  // reached Melbourne must wait for Melbourne, not start as it leaves Geelong.
  const next = stops[at + 1]?.days;
  const leave = here.days.leave;
  return next && leave >= next.arrive ? Math.max(here.days.arrive, next.arrive - 1e-6) : leave;
}

/** What a stretch draws on a day. */
export function segmentSpec(seg: VehicleSegment, fleet: readonly TripVehicle[], day: string): VehicleSpec {
  return resolveRef(seg.ref, fleet, day);
}

/** What drives a Virée's road at each moment, and where it changed. */
export interface DriveRoad {
  at(t: number, moment: DriveMoment): VehicleSpec;
  /** Sorted by time: a SWAP is another vehicle (a car becoming a boat at the shore), a REPAINT the same one in a new look. */
  transitions: readonly RoadTransition[];
}

export interface RoadTransition {
  t: number;
  kind: 'swap' | 'repaint';
}

export interface RoadInput {
  stages: readonly HookStage[];
  calendar: readonly HookDay[];
  fleet: readonly TripVehicle[];
  crossings?: TripCrossings;
  land?: LandIndex | null;
  /** The piece's day's vehicle, and the day itself — what an undated moment falls back on. */
  dayRef: VehicleRef;
  date: string;
  /** A vehicle the piece forces on its whole road (borrowed for the day), as dressed; null follows the trip. */
  forced: VehicleSpec | null;
}

/** How finely the timeline is read for changes: one per frame at 30 fps. */
const TRANSITION_STEP = 1 / 30;

/**
 * The road's vehicles as the painter reads them: the stretches, the look on
 * each moment's day, and every change along the timeline found once, here —
 * a swap at a shore, a repaint on its day — so the paint marks them without
 * remembering a previous frame (a frame of an export is drawn alone).
 */
export function driveRoad(plan: DrivePlan, input: RoadInput): { road: DriveRoad; vehicles: DriveVehicles } {
  const { stops } = plan.route;
  const forcedRef: VehicleRef | null = input.forced ? { borrow: input.forced.model, color: input.forced.color } : null;
  const vehicles = driveVehicles({
    stops,
    path: plan.path,
    geo: plan.geo,
    centre: PLAN_SIZE / 2,
    stages: input.stages,
    fleet: input.fleet,
    crossings: input.crossings,
    land: input.land,
    dayRef: input.dayRef,
    forced: forcedRef,
  });
  const at = (_t: number, m: DriveMoment): VehicleSpec => {
    if (input.forced) return input.forced;
    const seg = segmentAt(vehicles.segments, m.s);
    return segmentSpec(seg, input.fleet, momentDay(stops, plan.path, m.s, m.day, input.calendar, input.date));
  };
  const transitions: RoadTransition[] = [];
  if (!input.forced) {
    let prev: VehicleSpec | null = null;
    for (let t = 0; t <= plan.seconds + 1e-9; t += TRANSITION_STEP) {
      const spec = at(t, plan.at(t));
      if (prev && !sameVehicleSpec(prev, spec)) transitions.push({ t, kind: prev.model === spec.model ? 'repaint' : 'swap' });
      prev = spec;
    }
  }
  return { road: { at, transitions }, vehicles };
}
