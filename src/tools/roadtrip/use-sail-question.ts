import { useMemo } from 'react';
import { seaHops, shouldAskToSail } from '../../shared/roadtrip/sea-hops';
import type { TripDoc } from '../../shared/roadtrip/trip-types';
import { useLandIndex } from './use-land-index';

/**
 * How many hops a trip older than the water rule drives straight over the sea
 * while nobody has answered whether they sail (2026-10-17, face B of the Trajet
 * lab) — 0 when there is nothing to ask. Since 2026-11-07 (band option 1 of the
 * vehicles lab https://claude.ai/artifact/EYpL6XvriERXnN9AMbe459) the question
 * is no band over the overview: it waits at the top of the Vehicles panel, and
 * this count only puts a dot on the Map view's switch and the panel's way in.
 */
export function useSailQuestion(trip: Pick<TripDoc, 'stages' | 'crossings'>): number {
  const ask = shouldAskToSail(trip.crossings);
  const land = useLandIndex(ask);
  return useMemo(
    () => (ask && land ? seaHops(trip.stages, land, trip.crossings).length : 0),
    [ask, land, trip.stages, trip.crossings],
  );
}
