import { useEffect, useState } from 'react';
import type { ScriptSources } from '../../shared/story/story-script';
import type { TripMap } from '../../shared/story/trip-map';
import type { Lang } from '../../shared/story/locale';
import { mapNamesOf } from '../../shared/story/map-names';
import { useTripVersion } from './trip-changes';

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
export function useTripMap(sources: ScriptSources, lang?: Lang): TripMapState {
  const [state, setState] = useState<TripMapState>({ state: 'none' });
  const tripId = sources.trip?.id;
  // A trip written back from Storytelling (its road) is a new map too.
  const version = useTripVersion();
  const key = JSON.stringify({ trip: sources.trip ?? null, map: sources.map ?? null, lang: lang ?? 'fr', version });
  useEffect(() => {
    if (!tripId) {
      setState({ state: 'none' });
      return;
    }
    let alive = true;
    setState((s) => (s.state === 'ready' ? s : { state: 'reading' }));
    const naming = sources.map?.group?.name ?? 'town';
    void Promise.all([import('../../shared/roadtrip/trip-store'), import('../../shared/story/trip-map'), import('../../shared/story/sources'), import('../../shared/roadtrip/load-gazetteer')])
      .then(async ([store, maps, src, gaz]) => {
        // A group named by its biggest town, or a name that says the town, needs the shipped index: read it
        // (once per tab) before drawing.
        const names = mapNamesOf(sources.map);
        const wantsTowns = (sources.map?.group && naming === 'town') || names.line1 === 'town' || names.line2 === 'town';
        const towns = wantsTowns ? (await gaz.loadTowns().catch(() => null))?.sorted ?? null : null;
        const trip = (await store.listTrips()).find((t) => t.id === tripId) ?? null;
        if (!alive) return;
        if (!trip) {
          setState({ state: 'missing' });
          return;
        }
        setState({ state: 'ready', map: maps.tripMap(trip, { ...src.mapChoiceOf(sources), lang, towns }), span: src.countedSpan(trip, sources) });
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
