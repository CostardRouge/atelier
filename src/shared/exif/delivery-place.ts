/**
 * The PLACE a delivered picture was taken, named offline from its own GPS
 * (`docs/lightroom-gaps.md` §9, M4): written as XMP `photoshop:City`,
 * `photoshop:Country` and `Iptc4xmpCore:CountryCode`, the fields Lightroom,
 * Capture One and every photo library search by.
 *
 * **Offline, like every place name in the suite.** The answer comes from the
 * committed GeoNames index (`public/geo/cities.json`, `shared/roadtrip/
 * gazetteer.ts`) served from our own origin — reverse-geocoding through a
 * service would send the coordinates of the photographs out, a larger claim
 * than a name is worth, and the README's network callout stays as it is.
 *
 * **A place is its own group, apart from the position.** *Share online*
 * drops the coordinates and keeps the town: a city is what a viewer wants to
 * read, a position to the metre is what locates a house.
 *
 * **A city only where one is near.** A picture farther than `PLACE_MAX_KM`
 * from any named place gets no city — the index's own reach, 90 km, is right
 * for naming a LEG of a road trip and wrong for captioning ONE picture (the
 * Pinnacles are 35 km from Jurien Bay, the nearest town the index holds). The
 * COUNTRY still comes from the nearest town within that 90 km: countries are
 * large, and with no polygon index the one way it is wrong — a town across a
 * border being nearer than any of its own — needs a border within 90 km of
 * a picture no town of its own country is within 30 km of. Past 90 km,
 * nothing at all.
 *
 * Pure and DOM-free.
 */

import { DEFAULT_MAX_KM, nearestCity, type GazetteerCity } from '../roadtrip/gazetteer';
import type { GpsCoord } from './exif-parser';

/** How far a picture may be from a named place and still be captioned with it. */
export const PLACE_MAX_KM = 30;

export interface DeliveryPlace {
  /** The town, or '' when none is within `PLACE_MAX_KM` and only the country is known. */
  city: string;
  /** The country's English name, from its ISO code. */
  country: string;
  /** ISO 3166-1 alpha-2, as IPTC stores it. */
  countryCode: string;
}

let regions: Intl.DisplayNames | null | undefined;

/** A country's English name from its ISO code — the code itself where the runtime cannot say. */
export function countryName(code: string): string {
  if (regions === undefined) {
    try {
      regions = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regions = null;
    }
  }
  const upper = code.trim().toUpperCase();
  if (!upper) return '';
  try {
    return regions?.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/** Where `gps` was, by the index — a town and its country, the country alone, or null when nothing is near. */
export function placeFor(
  cities: readonly GazetteerCity[],
  gps: GpsCoord | null | undefined,
  maxKm: number = PLACE_MAX_KM,
): DeliveryPlace | null {
  if (!gps || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lon) || cities.length === 0) return null;
  const point = { lat: gps.lat, lon: gps.lon };
  const city = nearestCity(cities, point, maxKm);
  const found = city ?? nearestCity(cities, point, DEFAULT_MAX_KM);
  const countryCode = found?.country.trim().toUpperCase() ?? '';
  if (!found || (!city && !countryCode)) return null;
  return { city: city?.name ?? '', country: countryName(countryCode), countryCode };
}
