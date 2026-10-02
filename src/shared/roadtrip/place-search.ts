/**
 * What a place TAKES from a search result — the one seam between the
 * geocoder's answer (`shared/map/geocode.ts`) and the trip's record.
 *
 * The rule is the one `PlacesEditor` always had, widened to the new fields:
 * a fact the author wrote by hand is never overwritten by the service, a
 * fact the place lacked is filled, and nothing is written where the answer
 * had nothing — a place that knows less stays a place that knows less,
 * rather than one carrying five empty strings.
 *
 * Pure and DOM-free.
 */

import type { PlaceResult } from '../map/geocode';
import type { TripPlace } from './trip-types';

export function adoptSearchResult(place: TripPlace, result: PlaceResult): TripPlace {
  const next: TripPlace = {
    ...place,
    name: result.name,
    // Only fill a state the author has not written themselves. The one-line
    // region is the fallback for a service that sent no structured address.
    state: place.state.trim() || result.state || result.region,
    coords: { lat: result.lat, lon: result.lon },
    source: 'search',
  };
  const fill = (key: 'area' | 'country' | 'countryCode' | 'searchCode', value: string) => {
    if (!value) return;
    if ((next[key] ?? '').trim() && key !== 'searchCode') return;
    next[key] = value;
  };
  fill('area', result.area);
  fill('country', result.country);
  fill('countryCode', result.countryCode);
  // The search's code is the search's: it is replaced by a new answer and
  // never typed, so it is always taken — the author's own lives in `stateCode`.
  fill('searchCode', result.stateCode);
  if (!result.stateCode) delete next.searchCode;
  return next;
}
