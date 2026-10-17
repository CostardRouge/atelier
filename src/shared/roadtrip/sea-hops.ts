/**
 * The hops of a trip that cross the SEA, for the overview's nudge
 * (2026-10-17): a trip older than the water rule had `crossings.auto` turned
 * off by the v31 migration without being asked, so its car drives straight
 * across Bass Strait. This finds those hops on the same shipped coastline and
 * the same rule Virée reads (`terrain.ts`), over the STRAIGHT line between two
 * places — Virée groups nearby places and drives its curve or the trip's road —
 * so the nudge names the hops that cross the sea, not to the kilometre what
 * Virée will sail.
 *
 * A hop runs from one located place to the next in the order the trip was
 * lived — stages by their first day, places in their own order — and is left
 * out when its destination says how it was reached (`arriveBy`): that hop is
 * the author's already.
 *
 * Pure and DOM-free.
 */

import { hopTerrain, stepKm, type LandIndex, type RouteSample } from '../map/terrain';
import type { TripCrossings } from './vehicle-fleet';
import type { TripStage } from './trip-types';

export interface SeaHop {
  from: string;
  to: string;
  /** The water sailed, on the ground. */
  waterKm: number;
}

/** About one land test every two kilometres, as Virée samples a hop; capped so a long flight stays cheap. */
const STEP_KM = 2;
const MAX_SAMPLES = 600;

/** Whether the overview should ask: the rule is off and nobody has answered. */
export function shouldAskToSail(crossings: TripCrossings | undefined): boolean {
  return !!crossings && !crossings.auto && !crossings.asked;
}

/** A straight hop sampled for `hopTerrain`, its `s` running 0 → 1. */
function samplesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): RouteSample[] {
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

/** Every hop of the trip that would sail under `rule`, in the order it was lived. */
export function seaHops(
  stages: readonly TripStage[],
  land: LandIndex,
  rule: Pick<TripCrossings, 'bridgeKm' | 'shoreKm'>,
): SeaHop[] {
  const ordered = [...stages].sort((x, y) => (x.startDate < y.startDate ? -1 : x.startDate > y.startDate ? 1 : 0));
  const out: SeaHop[] = [];
  let prev: { name: string; lat: number; lon: number } | null = null;
  for (const stage of ordered) {
    for (const place of stage.places) {
      if (!place.coords) continue;
      const here = { name: place.name, ...place.coords };
      if (prev && (prev.lat !== here.lat || prev.lon !== here.lon) && !place.arriveBy) {
        const terrain = hopTerrain(land, samplesBetween(prev, here), rule);
        if (terrain.water) out.push({ from: prev.name, to: here.name, waterKm: terrain.waterKm });
      }
      prev = here;
    }
  }
  return out;
}
