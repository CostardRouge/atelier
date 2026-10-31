import { useEffect, useState } from 'react';
import type { ScriptSources } from '../../shared/story/story-script';
import type { TripMap } from '../../shared/story/trip-map';

export type TripMapState =
  | { state: 'none' }
  | { state: 'reading' }
  | { state: 'missing' }
  | { state: 'ready'; map: TripMap | null; span: { from: string; to: string } };

/**
 * The story map of the trip the series names (`sources.trip`), read from this
 * browser's trips, as the series chooses it — the stages it keeps, the points
 * it names and how (`sources.map`). The store and the road's maths are
 * imported when a trip is named, so a series without one carries neither.
 * `ready` with a null map is a trip with nothing to draw; `span` is the days
 * the kept stages cover (`countedSpan`).
 */
export function useTripMap(sources: ScriptSources): TripMapState {
  const [state, setState] = useState<TripMapState>({ state: 'none' });
  const tripId = sources.trip?.id;
  const key = JSON.stringify({ trip: sources.trip ?? null, map: sources.map ?? null });
  useEffect(() => {
    if (!tripId) {
      setState({ state: 'none' });
      return;
    }
    let alive = true;
    setState((s) => (s.state === 'ready' ? s : { state: 'reading' }));
    void Promise.all([import('../../shared/roadtrip/trip-store'), import('../../shared/story/trip-map'), import('../../shared/story/sources')])
      .then(async ([store, maps, src]) => {
        const trip = (await store.listTrips()).find((t) => t.id === tripId) ?? null;
        if (!alive) return;
        if (!trip) {
          setState({ state: 'missing' });
          return;
        }
        setState({ state: 'ready', map: maps.tripMap(trip, src.mapChoiceOf(sources)), span: src.countedSpan(trip, sources) });
      })
      .catch(() => {
        if (alive) setState({ state: 'missing' });
      });
    return () => {
      alive = false;
    };
    // `key` stands for the trip and the map choice: a new object of the same sources is no change.
  }, [tripId, key]);
  return state;
}
