import { useEffect, useState } from 'react';
import type { TripMap } from '../../shared/story/trip-map';

export type TripMapState =
  | { state: 'none' }
  | { state: 'reading' }
  | { state: 'missing' }
  | { state: 'ready'; map: TripMap | null; span: { from: string; to: string } };

/**
 * The story map of the trip the series names (`sources.trip`), read from this
 * browser's trips. The store and the road's maths are imported when a trip
 * is named, so a series without one carries neither. `ready` with a null map
 * is a trip with nothing to draw (no road, fewer than two named stage ends).
 */
export function useTripMap(tripId: string | null | undefined): TripMapState {
  const [state, setState] = useState<TripMapState>({ state: 'none' });
  useEffect(() => {
    if (!tripId) {
      setState({ state: 'none' });
      return;
    }
    let alive = true;
    setState({ state: 'reading' });
    void Promise.all([import('../../shared/roadtrip/trip-store'), import('../../shared/story/trip-map')])
      .then(async ([store, maps]) => {
        const trip = (await store.listTrips()).find((t) => t.id === tripId) ?? null;
        if (!alive) return;
        setState(trip ? { state: 'ready', map: maps.tripMap(trip), span: { from: trip.startDate, to: trip.endDate } } : { state: 'missing' });
      })
      .catch(() => {
        if (alive) setState({ state: 'missing' });
      });
    return () => {
      alive = false;
    };
  }, [tripId]);
  return state;
}
