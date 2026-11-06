import { useEffect, useMemo, useState } from 'react';
import { FORMATS, type RecapDoc } from '../../shared/recap/recap-doc';
import { shownPictures, type TripOpenerPlan } from '../../shared/recap/recap-opener-plan';
import { planTripOpener, tripCovering } from '../../shared/recap/recap-trip-opener';
import { templateDays, type ResolvedRecap } from '../../shared/recap/recap-slots';
import { listTrips } from '../../shared/roadtrip/trip-store';
import type { TripDoc } from '../../shared/roadtrip/trip-types';

/**
 * The trip of Trips covering the recap's days, read from this device's trips
 * (never fetched), and — when the opener is Virée or Itinerary — its plan,
 * made ready (fonts, a ground the trip asked) before the stage paints it.
 */
export function useTripOpener(doc: RecapDoc, resolved: ResolvedRecap): { trip: TripDoc | null; plan: TripOpenerPlan | null; version: number } {
  const [trips, setTrips] = useState<TripDoc[] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void listTrips().then((t) => alive && setTrips(t));
    return () => {
      alive = false;
    };
  }, []);
  const shown = useMemo(() => shownPictures(resolved), [resolved]);
  const days = useMemo(() => {
    const own = templateDays(doc);
    return own.length ? own : shown.flatMap((p) => (p.day ? [p.day] : []));
  }, [doc, shown]);
  const wanted = doc.opener.trip;
  const trip = useMemo(() => {
    if (!trips) return null;
    const own = wanted ? trips.find((t) => t.id === wanted) : undefined;
    return own ?? tripCovering(trips, days);
  }, [trips, days, wanted]);
  const kind = doc.opener.kind === 'drive' || doc.opener.kind === 'map' ? doc.opener.kind : null;
  const { width, height } = FORMATS[doc.format];
  const lastDay = days.length ? [...days].sort()[days.length - 1] : '';
  const plan = useMemo(() => (kind && trip && lastDay ? planTripOpener(kind, trip, shown, lastDay, width / height) : null), [kind, trip, shown, lastDay, width, height]);
  useEffect(() => {
    if (!plan?.ready) return;
    let alive = true;
    void plan
      .ready()
      .catch(() => undefined)
      .then(() => alive && setVersion((v) => v + 1));
    return () => {
      alive = false;
    };
  }, [plan]);
  return { trip, plan, version };
}
