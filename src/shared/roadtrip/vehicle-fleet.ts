/**
 * The trip's FLEET (2026-10-09, v31): the vehicles a journey drives, each
 * with the story of how it changed along the way.
 *
 * His asks, in one module: a journey may use more than one vehicle (*« un
 * véhicule sur une première étape du voyage et un autre véhicule sur
 * d'autres étapes »*), and a vehicle changes on the way (*« le Prado était
 * vert avant, et c'est en arrivant à Melbourne qu'on l'a repeint en Raptor
 * Black Matte »*). So the trip holds a list of vehicles — the first is its
 * MAIN one, what a stage that says nothing drives — and each vehicle holds
 * its state as it set off (`spec`) plus dated CHANGES: from that day on, it
 * wears that look. A change is the WHOLE look (colour, finish, gear), never
 * a patch, so reading one needs nothing before it; the model is the
 * vehicle's and never changes in a change — another model is another vehicle.
 *
 * A change is dated by a DAY because the trip is tracked by calendar day and
 * so is every reader of it (a piece's date, the recap's clock); the place it
 * happened is the author's words beside it, said and never resolved.
 *
 * Who drives what, where: a stage may name a vehicle (`TripStage.vehicle`), a
 * place may say how it was reached (`TripPlace.arriveBy` — the hop that leads
 * to it), and both are a `VehicleRef`: one of the fleet, or a model borrowed
 * for the day (a boat to the reef). `TripCrossings` is the trip's rule for
 * water: whether a hop that crosses it takes a boat by itself, which boat,
 * and the two distances that make the coastline's resolution honest
 * (`terrain.ts`).
 *
 * Pure and DOM-free: every reader is defensive, nothing stored is trusted.
 */

import { isIsoDate, type IsoDate } from './trip-days';
import {
  defaultVehicleSpec,
  isVehicleModelId,
  readVehicleSpec,
  vehicleKind,
  type VehicleModelId,
  type VehicleSpec,
} from './vehicle-spec';

/** A vehicle's look without its model: what a change may alter. */
export type VehicleLook = Omit<VehicleSpec, 'model'>;

export interface VehicleChange {
  id: string;
  /** The day it takes effect — the vehicle wears this look from that day on. */
  from: IsoDate;
  /** Where it happened, in the author's words ("Melbourne"); said, never resolved. */
  place?: string;
  look: VehicleLook;
}

export interface TripVehicle {
  id: string;
  /** As it set off: the model, and its look before any change. */
  spec: VehicleSpec;
  /** Its changes, earliest first. */
  changes: VehicleChange[];
}

/** One of the trip's own vehicles, or a model borrowed for a day in a paint of its own (empty: as it comes). */
export type VehicleRef = { fleet: string } | { borrow: VehicleModelId; color?: string };

/** The trip's rule for water (`terrain.ts`). */
export interface TripCrossings {
  /** A hop that crosses water takes a boat by itself. */
  auto: boolean;
  /** The boat a crossing takes when nothing else says. */
  boat: VehicleModelId;
  /** Water shorter than this between two lands is a bridge or a causeway: the vehicle stays on it. */
  bridgeKm: number;
  /** A stop this close to a coast is ashore — the shipped coastline is 1:50m, and a harbour town can fall in its sea. */
  shoreKm: number;
}

export const DEFAULT_CROSSINGS: Readonly<TripCrossings> = Object.freeze({
  auto: true,
  boat: 'whitsunday-cruiser',
  bridgeKm: 2,
  shoreKm: 5,
});

export const CROSSING_LIMITS = {
  bridgeKm: { min: 0, max: 20 },
  shoreKm: { min: 0, max: 15 },
} as const;

/** The id of a fleet's first vehicle when nothing gave it one. */
export const MAIN_VEHICLE_ID = 'main';

const HEX = /^#[0-9a-f]{6}$/i;

/** A fleet of one: the trip's vehicle as it was before v31. */
export function fleetOf(spec: VehicleSpec): TripVehicle[] {
  return [{ id: MAIN_VEHICLE_ID, spec, changes: [] }];
}

/** The trip's main vehicle — what a stage that names none drives; the default vehicle for a hand-built trip with no fleet. */
export function mainVehicle(fleet: readonly TripVehicle[] | undefined): TripVehicle {
  return fleet?.[0] ?? fleetOf(defaultVehicleSpec())[0];
}

/** A vehicle of the fleet by id — the main one for an id the fleet no longer holds. */
export function fleetVehicle(fleet: readonly TripVehicle[], id: string): TripVehicle {
  return fleet.find((v) => v.id === id) ?? mainVehicle(fleet);
}

function lookOf(spec: VehicleSpec): VehicleLook {
  return { color: spec.color, finish: spec.finish, gear: { ...spec.gear } };
}

/** A look read against its vehicle's model — what that model comes with for anything unreadable. */
function readLook(raw: unknown, model: VehicleModelId): VehicleLook {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return lookOf(readVehicleSpec({ ...r, model }));
}

/** A stored fleet, read defensively: never empty, ids unique, changes dated and in order. */
export function readFleet(raw: unknown, fallback: VehicleSpec = defaultVehicleSpec()): TripVehicle[] {
  if (!Array.isArray(raw) || raw.length === 0) return fleetOf(fallback);
  const ids = new Set<string>();
  const out: TripVehicle[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const r = item as Record<string, unknown>;
    const spec = readVehicleSpec(r.spec);
    let id = typeof r.id === 'string' && r.id ? r.id : i === 0 ? MAIN_VEHICLE_ID : `vehicle-${i + 1}`;
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const changeIds = new Set<string>();
    const changes: VehicleChange[] = [];
    (Array.isArray(r.changes) ? r.changes : []).forEach((c, k) => {
      if (!c || typeof c !== 'object') return;
      const cr = c as Record<string, unknown>;
      if (typeof cr.from !== 'string' || !isIsoDate(cr.from)) return;
      let cid = typeof cr.id === 'string' && cr.id ? cr.id : `change-${k + 1}`;
      while (changeIds.has(cid)) cid = `${cid}-${k + 1}`;
      changeIds.add(cid);
      const change: VehicleChange = { id: cid, from: cr.from, look: readLook(cr.look, spec.model) };
      if (typeof cr.place === 'string' && cr.place.trim()) change.place = cr.place.trim();
      changes.push(change);
    });
    out.push({ id, spec, changes: sortChanges(changes) });
  });
  return out.length ? out : fleetOf(fallback);
}

function sortChanges(changes: VehicleChange[]): VehicleChange[] {
  return [...changes].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

export function readCrossings(raw: unknown, fallback: TripCrossings = DEFAULT_CROSSINGS): TripCrossings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const km = (v: unknown, lim: { min: number; max: number }, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(lim.max, Math.max(lim.min, v)) : d;
  const boat = isVehicleModelId(r.boat) && vehicleKind(r.boat) === 'boat' ? r.boat : fallback.boat;
  return {
    auto: typeof r.auto === 'boolean' ? r.auto : fallback.auto,
    boat,
    bridgeKm: km(r.bridgeKm, CROSSING_LIMITS.bridgeKm, fallback.bridgeKm),
    shoreKm: km(r.shoreKm, CROSSING_LIMITS.shoreKm, fallback.shoreKm),
  };
}

/** A stored reference, or undefined when it says nothing readable. */
export function readVehicleRef(raw: unknown): VehicleRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.fleet === 'string' && r.fleet) return { fleet: r.fleet };
  if (isVehicleModelId(r.borrow)) {
    return typeof r.color === 'string' && HEX.test(r.color) ? { borrow: r.borrow, color: r.color.toLowerCase() } : { borrow: r.borrow };
  }
  return undefined;
}

export function sameRef(a: VehicleRef | undefined, b: VehicleRef | undefined): boolean {
  if (!a || !b) return a === b;
  if ('fleet' in a) return 'fleet' in b && a.fleet === b.fleet;
  return 'borrow' in b && a.borrow === b.borrow && (a.color ?? '') === (b.color ?? '');
}

/** The change in effect on a day — the last one dated on or before it; null before the first, or with no day. */
export function changeOn(vehicle: TripVehicle, day: IsoDate | null | undefined): VehicleChange | null {
  if (!day) return null;
  let found: VehicleChange | null = null;
  for (const change of vehicle.changes) if (change.from <= day) found = change;
  return found;
}

/** A vehicle as it is on a day: its start, or the last change made by then. No day: as it set off. */
export function vehicleOnDay(vehicle: TripVehicle, day: IsoDate | null | undefined): VehicleSpec {
  const change = changeOn(vehicle, day);
  return change ? { model: vehicle.spec.model, ...lookOf({ model: vehicle.spec.model, ...change.look }) } : vehicle.spec;
}

/** What a reference drives on a day; a fleet id no longer in the fleet is the main vehicle. */
export function resolveRef(ref: VehicleRef, fleet: readonly TripVehicle[], day: IsoDate | null | undefined): VehicleSpec {
  if ('fleet' in ref) return vehicleOnDay(fleetVehicle(fleet, ref.fleet), day);
  const spec = defaultVehicleSpec(ref.borrow);
  return ref.color && HEX.test(ref.color) ? { ...spec, color: ref.color.toLowerCase() } : spec;
}

/**
 * The vehicle with a new look on a day — written to whatever state is in
 * effect then (its start, or that change), so dressing the vehicle from a
 * piece dated after Melbourne repaints the Prado as it was after Melbourne.
 * A new MODEL replaces the vehicle's model in every state: another model is
 * the same vehicle only when the author says so here.
 */
export function withLookOn(vehicle: TripVehicle, day: IsoDate | null | undefined, spec: VehicleSpec): TripVehicle {
  const change = changeOn(vehicle, day);
  const model = spec.model;
  const look = lookOf(spec);
  if (!change) return { ...vehicle, spec: { model, ...look } };
  return {
    ...vehicle,
    spec: model === vehicle.spec.model ? vehicle.spec : { ...vehicle.spec, model },
    changes: vehicle.changes.map((c) => (c.id === change.id ? { ...c, look } : c)),
  };
}

/** A new change on a day, its look whatever the vehicle wears then — a repaint starts from what it repaints. */
export function addChange(vehicle: TripVehicle, from: IsoDate, place = ''): TripVehicle {
  const ids = new Set(vehicle.changes.map((c) => c.id));
  let n = vehicle.changes.length + 1;
  while (ids.has(`change-${n}`)) n += 1;
  const change: VehicleChange = { id: `change-${n}`, from, look: lookOf(vehicleOnDay(vehicle, from)) };
  if (place.trim()) change.place = place.trim();
  return { ...vehicle, changes: sortChanges([...vehicle.changes, change]) };
}

/** A change edited — its day, its place or its look — kept in order. */
export function updateChange(vehicle: TripVehicle, id: string, patch: Partial<Omit<VehicleChange, 'id'>>): TripVehicle {
  return {
    ...vehicle,
    changes: sortChanges(
      vehicle.changes.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        if (next.place !== undefined && !next.place.trim()) delete next.place;
        return next;
      }),
    ),
  };
}

export function removeChange(vehicle: TripVehicle, id: string): TripVehicle {
  return { ...vehicle, changes: vehicle.changes.filter((c) => c.id !== id) };
}

/** A second (third…) vehicle for the fleet, as its model comes. */
export function addVehicle(fleet: readonly TripVehicle[], model: VehicleModelId): TripVehicle[] {
  const ids = new Set(fleet.map((v) => v.id));
  let n = fleet.length + 1;
  while (ids.has(`vehicle-${n}`)) n += 1;
  return [...fleet, { id: `vehicle-${n}`, spec: defaultVehicleSpec(model), changes: [] }];
}

/** A vehicle out of the fleet — never the last one; what referred to it falls back to the main vehicle. */
export function removeVehicle(fleet: readonly TripVehicle[], id: string): TripVehicle[] {
  if (fleet.length <= 1) return [...fleet];
  return fleet.filter((v) => v.id !== id);
}

/** A vehicle made the main one — first in the list. */
export function makeMain(fleet: readonly TripVehicle[], id: string): TripVehicle[] {
  const vehicle = fleet.find((v) => v.id === id);
  return vehicle ? [vehicle, ...fleet.filter((v) => v.id !== id)] : [...fleet];
}

export function replaceVehicle(fleet: readonly TripVehicle[], next: TripVehicle): TripVehicle[] {
  return fleet.map((v) => (v.id === next.id ? next : v));
}

/** A stage as the vehicle reader needs it: its span and what it drives. */
interface StageSpan {
  startDate: IsoDate;
  endDate: IsoDate;
  vehicle?: VehicleRef;
}

/**
 * What a day drives when nothing nearer says: the vehicle of the stage the
 * day is in — the LAST match, the rule `stageAt` uses — else the main one.
 */
export function vehicleRefForDay(fleet: readonly TripVehicle[], stages: readonly StageSpan[], day: IsoDate | null | undefined): VehicleRef {
  if (day) {
    let found: StageSpan | null = null;
    for (const stage of stages) if (stage.startDate <= day && day <= stage.endDate) found = stage;
    if (found?.vehicle) return found.vehicle;
  }
  return { fleet: mainVehicle(fleet).id };
}
