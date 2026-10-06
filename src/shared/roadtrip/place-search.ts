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

/** What a place is REPLACED by when it is corrected: another town of its name, or a search's answer. */
export interface PlaceFacts {
  name: string;
  state: string;
  area?: string;
  /** The service's state code ("WA"); none from the index. */
  searchCode?: string;
  country?: string;
  countryCode?: string;
  coords: { lat: number; lon: number };
  source: NonNullable<TripPlace['source']>;
}

/**
 * The place made another one — the Exmouth in Devon corrected to the one in
 * Western Australia. Unlike `adoptSearchResult`, which only FILLS what a
 * place lacks, this takes the new town's identity whole (name, state,
 * area, codes, country, position), because every one of the old facts was
 * the wrong town's. What belongs to the visit and not to the town stays:
 * the id, the dates, the writing, and the author's own code where it names
 * the same state.
 */
export function replacePlace(place: TripPlace, facts: PlaceFacts): TripPlace {
  const next: TripPlace = { ...place, name: facts.name, state: facts.state, coords: { ...facts.coords }, source: facts.source };
  for (const key of ['area', 'searchCode', 'country', 'countryCode'] as const) {
    const value = (facts[key] ?? '').trim();
    if (value) next[key] = key === 'countryCode' ? value.toUpperCase() : value;
    else delete next[key];
  }
  if (place.state.trim() !== facts.state.trim()) {
    delete next.stateCode;
    delete next.codeFrom;
  }
  return next;
}

/** A search's answer as the facts a place is replaced by. */
export function searchFacts(result: PlaceResult): PlaceFacts {
  return {
    name: result.name,
    state: result.state || result.region,
    area: result.area,
    searchCode: result.stateCode,
    country: result.country,
    countryCode: result.countryCode,
    coords: { lat: result.lat, lon: result.lon },
    source: 'search',
  };
}
