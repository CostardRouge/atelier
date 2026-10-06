/**
 * Whether a place is in the WRONG place — the Exmouth in Devon on a trip
 * through Western Australia, put there by a search that answered the
 * other town of the name first.
 *
 * Two facts together, never one: the place is in another country than the
 * trip's (`tripCountry`), AND it lies more than `ODD_KM` from what it is
 * measured against — its halt's pictures in Deduce, the rest of its stage
 * on a stage card. A real stopover abroad, photographed where it is, is
 * near its reference and stays a plain place; a town in the trip's own
 * country is never suspected by distance alone, since a long leg is not an
 * error.
 *
 * It only SAYS: nothing is corrected, moved or hidden, and the maps still
 * frame every place — the maintainer's call (2026-10-06): the map shows
 * what is, and the line says why it looks wrong.
 *
 * Pure and DOM-free.
 */

import { haversineKm, type GeoPoint } from './hooks/geo';
import type { TripDoc, TripPlace, TripStage } from './trip-types';

/** Far enough for a road trip's longest day, close enough to catch another continent. */
export const ODD_KM = 500;

export interface Oddity {
  /** In another country than the trip's, and far from what it is measured against. */
  odd: boolean;
  /** Its distance to that reference; null where either side has no position. */
  km: number | null;
}

export function placeOddity(
  place: Pick<TripPlace, 'countryCode' | 'coords'>,
  reference: GeoPoint | null,
  home: string,
  limitKm: number = ODD_KM,
): Oddity {
  const km = place.coords && reference ? haversineKm(reference, place.coords) : null;
  const code = (place.countryCode ?? '').trim().toUpperCase();
  const foreign = !!code && !!home && code !== home.trim().toUpperCase();
  return { odd: foreign && km !== null && km > limitKm, km };
}

function centroid(points: readonly GeoPoint[]): GeoPoint | null {
  if (!points.length) return null;
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lon: points.reduce((sum, p) => sum + p.lon, 0) / points.length,
  };
}

/**
 * What a place of a stage is measured against when there are no pictures
 * to hand: the centre of its stage's OTHER located places, else of every
 * other located place of the trip — so a stage of one place is still
 * compared with something.
 */
export function stageReference(
  stage: Pick<TripStage, 'places'>,
  placeId: string,
  trip: Pick<TripDoc, 'stages'>,
): GeoPoint | null {
  const others = (places: readonly TripPlace[]) =>
    places.filter((p) => p.id !== placeId && p.coords).map((p) => p.coords!);
  return (
    centroid(others(stage.places ?? [])) ??
    centroid(others((trip.stages ?? []).flatMap((s) => s.places ?? [])))
  );
}
