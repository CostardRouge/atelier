/**
 * The trip's HOPS, each with the vehicle that makes it and why (2026-10-17,
 * the Trajet band — lab https://claude.ai/artifact/RrtxniqsSSYW3sKNkCS1kY).
 *
 * A hop runs from one located place to the next in the order the trip was
 * lived — stages by their first day, places in their own order, a place met
 * twice in a row counted once — and belongs to the place it leads to, which
 * is where its choices are written (`arriveBy`, `crossBy`, `flown`).
 *
 * The chain is `vehicle-plan.ts`'s, read here for the whole trip rather than
 * for one piece: not driven › the place's vehicle › water under the rule (the
 * place's boat for the crossing, else the stage's vehicle if it is a boat,
 * else the rule's boat) › the stage's vehicle › the trip's main vehicle. The
 * water is read on the STRAIGHT line between the two places over the shipped
 * coastline; Virée groups nearby places and drives its curve or the trip's
 * road, so the band names which hops cross the sea and roughly how far, not to
 * the kilometre what a piece will sail.
 *
 * Pure and DOM-free.
 */

import { hopTerrain, stepKm, type HopTerrain, type LandIndex, type RouteSample } from '../map/terrain';
import type { TripDoc, TripPlace, TripStage } from './trip-types';
import { mainVehicle, type TripVehicle, type VehicleRef } from './vehicle-fleet';
import { vehicleKind } from './vehicle-spec';

/** Why a hop is made the way it is — said on its row. */
export type HopWhy = 'flown' | 'place' | 'water' | 'stage' | 'trip';

export interface TripHop {
  /** The place the hop leads to — where its choices are written. */
  to: TripPlace;
  from: TripPlace;
  stageId: string;
  /** Kilometres as the crow flies. */
  km: number;
  /** The kilometres at sea on the straight line, split as road before, sea, road after; null with no coastline. */
  sea: { before: number; water: number; after: number } | null;
  why: HopWhy;
  /** What drives the land of the hop (the whole hop when it does not sail). */
  ref: VehicleRef;
  /** What sails its water, when it sails; and whether the place chose it. */
  boat?: { ref: VehicleRef; own: boolean };
  /** At sea, but the rule is off: the land vehicle drives straight over it. */
  wet?: boolean;
}

/** About one land test every two kilometres; capped so a long flight stays cheap. */
const STEP_KM = 2;
const MAX_SAMPLES = 600;

/** A straight hop sampled for `hopTerrain`, its `s` running 0 → 1. */
export function straightSamples(a: { lat: number; lon: number }, b: { lat: number; lon: number }): RouteSample[] {
  const n = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(stepKm(a, b) / STEP_KM)));
  const out: RouteSample[] = [];
  let km = 0;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = { lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u };
    if (i) km += stepKm(out[i - 1], p);
    out.push({ ...p, s: u, km });
  }
  return out;
}

/**
 * A straight hop's terrain, remembered per coastline: the band re-reads every
 * hop on each edit of the trip, and a long trip is a hundred hops of a few
 * hundred land tests each.
 */
const terrainCache = new WeakMap<LandIndex, Map<string, HopTerrain>>();

function cachedTerrain(
  land: LandIndex,
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  rule: { bridgeKm: number; shoreKm: number },
): HopTerrain {
  let byKey = terrainCache.get(land);
  if (!byKey) terrainCache.set(land, (byKey = new Map()));
  const key = `${a.lat},${a.lon}|${b.lat},${b.lon}|${rule.bridgeKm}|${rule.shoreKm}`;
  let found = byKey.get(key);
  if (!found) {
    found = hopTerrain(land, straightSamples(a, b), rule);
    if (byKey.size > 4000) byKey.clear();
    byKey.set(key, found);
  }
  return found;
}

/** The stages in the order they were lived. */
export function stagesInOrder(stages: readonly TripStage[]): TripStage[] {
  return [...stages].sort((x, y) => (x.startDate < y.startDate ? -1 : x.startDate > y.startDate ? 1 : 0));
}

/** Every hop of the trip, with its vehicle and why. `land` null: no water is read. */
export function tripHops(trip: Pick<TripDoc, 'stages' | 'vehicles' | 'crossings'>, land: LandIndex | null): TripHop[] {
  const main = mainVehicle(trip.vehicles);
  const rule = trip.crossings;
  const out: TripHop[] = [];
  let prev: TripPlace | null = null;
  for (const stage of stagesInOrder(trip.stages)) {
    for (const place of stage.places) {
      if (!place.coords) continue;
      if (prev && prev.coords && (prev.coords.lat !== place.coords.lat || prev.coords.lon !== place.coords.lon)) {
        out.push(hopOf(prev, place, stage, main, trip.vehicles, rule, land));
      }
      prev = place;
    }
  }
  return out;
}

function hopOf(
  from: TripPlace,
  to: TripPlace,
  stage: TripStage,
  main: TripVehicle,
  fleet: readonly TripVehicle[],
  rule: TripDoc['crossings'],
  land: LandIndex | null,
): TripHop {
  const a = from.coords!;
  const b = to.coords!;
  const km = stepKm(a, b);
  const base = { from, to, stageId: stage.id, km };
  const landRef: VehicleRef = stage.vehicle ?? { fleet: main.id };
  const landWhy: HopWhy = stage.vehicle ? 'stage' : 'trip';
  if (to.flown) return { ...base, sea: null, why: 'flown', ref: landRef };
  const terrain = land ? cachedTerrain(land, a, b, rule) : null;
  const sea = terrain
    ? terrain.water
      ? { before: terrain.water.s0 * km, water: terrain.waterKm, after: Math.max(0, km - terrain.water.s1 * km) }
      : { before: km, water: 0, after: 0 }
    : null;
  if (to.arriveBy) return { ...base, sea, why: 'place', ref: to.arriveBy };
  if (!sea?.water) return { ...base, sea, why: landWhy, ref: landRef };
  if (!rule.auto) return { ...base, sea, why: landWhy, ref: landRef, wet: true };
  const model = 'borrow' in landRef ? landRef.borrow : (fleet.find((v) => v.id === landRef.fleet) ?? main).spec.model;
  const boat: VehicleRef = to.crossBy ?? (vehicleKind(model) === 'boat' ? landRef : { borrow: rule.boat });
  return { ...base, sea, why: 'water', ref: landRef, boat: { ref: boat, own: !!to.crossBy } };
}

/** How the hop leading to a place is made, as the band chooses it. */
export type HopChoice = { kind: 'auto' } | { kind: 'flown' } | { kind: 'vehicle'; ref: VehicleRef };

/** The trip with one place's fields rewritten, by id; the trip itself when no place has it. */
export function withPlace(trip: TripDoc, placeId: string, edit: (place: TripPlace) => TripPlace): TripDoc {
  let found = false;
  const stages = trip.stages.map((stage) => {
    if (!stage.places.some((p) => p.id === placeId)) return stage;
    found = true;
    return { ...stage, places: stage.places.map((p) => (p.id === placeId ? edit(p) : p)) };
  });
  return found ? { ...trip, stages } : trip;
}

/** Write how the hop leading to a place is made: decided by the road, not driven, or one vehicle for the whole hop. */
export function withHopChoice(trip: TripDoc, placeId: string, choice: HopChoice): TripDoc {
  return withPlace(trip, placeId, (place) => {
    const next = { ...place };
    delete next.arriveBy;
    delete next.flown;
    if (choice.kind === 'flown') next.flown = true;
    else if (choice.kind === 'vehicle') next.arriveBy = choice.ref;
    if (choice.kind !== 'auto') delete next.crossBy;
    return next;
  });
}

/** Write the boat for the water of the hop leading to a place; null gives it back to the rule. */
export function withCrossBoat(trip: TripDoc, placeId: string, boat: VehicleRef | null): TripDoc {
  return withPlace(trip, placeId, (place) => {
    const next = { ...place };
    if (boat) next.crossBy = boat;
    else delete next.crossBy;
    return next;
  });
}

/** Write what a stage drives; null gives it back to the trip's main vehicle. */
export function withStageVehicle(trip: TripDoc, stageId: string, ref: VehicleRef | null): TripDoc {
  return {
    ...trip,
    stages: trip.stages.map((stage) => {
      if (stage.id !== stageId) return stage;
      const next = { ...stage };
      if (ref) next.vehicle = ref;
      else delete next.vehicle;
      return next;
    }),
  };
}
