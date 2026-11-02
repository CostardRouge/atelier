import { useSyncExternalStore } from 'react';
import type { TripDoc } from '../../shared/roadtrip/trip-types';

/**
 * Storytelling writes a trip back (its ROAD, the trip's own settings, road lab
 * C2) and everything that read it must read it again: the map, the Sources
 * panel. The trip store keeps no listeners, so this is the tool's own signal —
 * a version bumped by `writeTrip`, read by `useTripVersion`.
 */
let version = 0;
const listeners = new Set<() => void>();

export function useTripVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/** Write a trip as Trips does (stamped), then tell every reader. Returns false when the store refused. */
export async function writeTrip(trip: TripDoc): Promise<boolean> {
  const { putTrip } = await import('../../shared/roadtrip/trip-store');
  const ok = await putTrip({ ...trip, updatedAt: Date.now() });
  if (ok) {
    version += 1;
    for (const l of listeners) l();
  }
  return ok;
}
