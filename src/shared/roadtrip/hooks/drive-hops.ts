/**
 * Virée's road as the Trajet rows say it (2026-10-17, face C of the lab
 * https://claude.ai/artifact/RrtxniqsSSYW3sKNkCS1kY): one line per hop of the
 * piece's OWN road — its stops as grouped, its curve or the trip's road, the
 * water its coastline test found — read off the very `DriveVehicles` the
 * painter draws, so the panel cannot say one thing while the frame shows
 * another. A hop whose stop is a trip place carries that place, so a row can
 * write its choice; a stop of the author's own list or a picture is read only.
 *
 * Pure and DOM-free.
 */

import { stepKm } from '../../map/terrain';
import type { HopLine, HopWhy } from '../trip-hops';
import type { DriveStop, RoadPath } from './drive-plan';
import type { DriveVehicles, VehicleSegment } from './vehicle-plan';

/** The kilometres driven at arc length `s`, where the path counts them (the trip's road); else null. */
function kmAt(path: RoadPath, s: number): number | null {
  const km = path.km;
  if (!km || km.length !== path.cum.length || !km.length) return null;
  if (s <= path.cum[0]) return km[0];
  for (let i = 1; i < path.cum.length; i++) {
    if (s <= path.cum[i]) {
      const span = path.cum[i] - path.cum[i - 1];
      const u = span > 0 ? (s - path.cum[i - 1]) / span : 0;
      return km[i - 1] + (km[i] - km[i - 1]) * u;
    }
  }
  return km[km.length - 1];
}

/** Every hop of the road, with what makes it and why. */
export function driveHopLines(stops: readonly DriveStop[], path: RoadPath, vehicles: DriveVehicles): HopLine[] {
  const out: HopLine[] = [];
  for (let h = 0; h + 1 < stops.length; h++) {
    const from = stops[h];
    const to = stops[h + 1];
    const s0 = path.stopS[h];
    const s1 = path.stopS[h + 1];
    if (s0 === undefined || s1 === undefined) break;
    const a = kmAt(path, s0);
    const b = kmAt(path, s1);
    const km = a !== null && b !== null ? Math.max(0, b - a) : stepKm(from, to);
    const span = s1 - s0;
    const inside: VehicleSegment[] = vehicles.segments.filter((seg) => seg.s1 > s0 + 1e-9 && seg.s0 < s1 - 1e-9);
    const via = to.source ?? to.reachedAt;
    const place = via?.placeId
      ? {
          id: via.placeId,
          ...(via.arriveBy ? { arriveBy: via.arriveBy } : {}),
          ...(via.crossBy ? { crossBy: via.crossBy } : {}),
          ...(via.flown ? { flown: true as const } : {}),
        }
      : undefined;
    const base = { key: String(h), from: from.name, to: to.name, km, ...(place ? { place } : {}) };
    const hidden = inside.find((seg) => seg.hidden);
    if (hidden) {
      out.push({ ...base, sea: null, why: 'flown', ref: hidden.ref });
      continue;
    }
    const water = inside.find((seg) => seg.source === 'water');
    const land = inside.find((seg) => seg.source !== 'water') ?? inside[0];
    const read = vehicles.hops[h] !== null && vehicles.hops[h] !== undefined;
    if (water && span > 0) {
      const f0 = Math.max(0, Math.min(1, (water.s0 - s0) / span));
      const f1 = Math.max(f0, Math.min(1, (water.s1 - s0) / span));
      out.push({
        ...base,
        sea: { before: f0 * km, water: (f1 - f0) * km, after: (1 - f1) * km },
        why: 'water',
        ref: (land ?? water).ref,
        boat: { ref: water.ref, own: !!via?.crossBy },
      });
      continue;
    }
    if (!land) continue;
    const why: HopWhy = land.source === 'place' ? 'place' : land.source === 'stage' ? 'stage' : 'trip';
    out.push({ ...base, sea: read ? { before: km, water: 0, after: 0 } : null, why, ref: land.ref });
  }
  return out;
}
