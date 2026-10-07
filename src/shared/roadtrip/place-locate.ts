import { homonyms, type GazetteerCity } from './gazetteer';
import { replacePlace } from './place-search';
import { countryName, tripCountry } from './place-style';
import { officialStateCode } from './state-codes';
import type { TripDoc, TripPlace, TripStage } from './trip-types';

/**
 * «Locate» on the trip's map does what it says (2026-10-07, his ask after
 * «Not on the map» listed Newcastle while a town label read Newcastle): a
 * place that has a NAME and no position is looked up in the index of towns
 * shipped with Atelier — offline, the index «Fix › Same name» reads — and,
 * where the answer is not in doubt, placed in one click.
 *
 * Not in doubt means, in this order:
 * - only towns of the place's own country, else the trip's (a lookup never
 *   crosses a border on its own — the bug class of Exmouth in Devon);
 * - where the place says its state, only towns of that state;
 * - then ONE town left, or the nearest one clearly nearer the stages around
 *   it than the next (within `NEAR_KM`, the next `CLEAR` times as far).
 *
 * Anything else is left to the person, through Fix. The place keeps its id,
 * its dates and its writing (`replacePlace`).
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** One place the index answers for without doubt. */
export interface IndexPick {
  stageId: string;
  placeId: string;
  city: GazetteerCity;
  /** From the stages around it; null when nothing around it has a position. */
  km: number | null;
}

export interface StageLookup {
  /** Its places the index answers for. */
  sure: IndexPick[];
  /** Its named places without a position the index cannot settle. */
  unsure: string[];
}

/** The nearest town, at most this far from the stages around it, to be taken alone… */
const NEAR_KM = 300;
/** …and only when the next one is at least this many times as far. */
const CLEAR = 3;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function centroid(points: readonly GeoPoint[]): GeoPoint | null {
  if (!points.length) return null;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
  };
}

const located = (places: readonly TripPlace[]): GeoPoint[] => places.flatMap((p) => (p.coords ? [p.coords] : []));

/**
 * Where a place of this stage should be near: the stage's other located
 * places, else the located stages just before and just after it in lived
 * order (the end of the one before, the start of the one after), else the
 * whole trip's.
 */
export function lookupReference(trip: Pick<TripDoc, 'stages'>, stage: TripStage): GeoPoint | null {
  const own = centroid(located(stage.places ?? []));
  if (own) return own;
  const ordered = [...trip.stages].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  const at = ordered.indexOf(stage);
  const around: GeoPoint[] = [];
  for (let i = at - 1; i >= 0; i -= 1) {
    const points = located(ordered[i].places ?? []);
    if (points.length) {
      around.push(points[points.length - 1]);
      break;
    }
  }
  for (let i = at + 1; i < ordered.length; i += 1) {
    const points = located(ordered[i].places ?? []);
    if (points.length) {
      around.push(points[0]);
      break;
    }
  }
  return centroid(around) ?? centroid(trip.stages.flatMap((s) => located(s.places ?? [])));
}

function sameState(city: GazetteerCity, state: string, country: string): boolean {
  const want = fold(state);
  if (!want) return true;
  if (fold(city.region) === want) return true;
  // «QLD» written where the index says «Queensland».
  const code = officialStateCode(city.region, country);
  return !!code && fold(code) === want;
}

/** The one town the index gives this place without doubt, or null. */
export function indexAnswer(
  place: Pick<TripPlace, 'name' | 'state' | 'countryCode'>,
  cities: readonly GazetteerCity[],
  near: GeoPoint | null,
  home: string,
): { city: GazetteerCity; km: number | null } | null {
  if (!place.name.trim()) return null;
  const country = (place.countryCode || home).trim().toUpperCase();
  let found = homonyms(cities, place.name, near, 50);
  if (country) found = found.filter((f) => f.city.country.toUpperCase() === country);
  if (place.state.trim()) found = found.filter((f) => sameState(f.city, place.state, country));
  if (!found.length) return null;
  // A suburb of the same name stands aside for the town itself.
  const towns = found.filter((f) => !f.city.section);
  const pool = towns.length ? towns : found;
  if (pool.length === 1) return pool[0];
  const [first, second] = pool;
  if (first.km === null || second.km === null) return null;
  return first.km <= NEAR_KM && second.km >= CLEAR * Math.max(first.km, 1) ? first : null;
}

/** What the index says for each stage holding a named place with no position. */
export function lookupTrip(trip: Pick<TripDoc, 'stages'>, cities: readonly GazetteerCity[]): Map<string, StageLookup> {
  const home = tripCountry(trip);
  const out = new Map<string, StageLookup>();
  for (const stage of trip.stages) {
    const missing = (stage.places ?? []).filter((p) => !p.coords && p.name.trim());
    if (!missing.length) continue;
    const near = lookupReference(trip, stage);
    const entry: StageLookup = { sure: [], unsure: [] };
    for (const place of missing) {
      const answer = indexAnswer(place, cities, near, home);
      if (answer) entry.sure.push({ stageId: stage.id, placeId: place.id, city: answer.city, km: answer.km });
      else entry.unsure.push(place.id);
    }
    out.set(stage.id, entry);
  }
  return out;
}

/** A place at the town the index found for it. */
export function placeAtCity(place: TripPlace, city: GazetteerCity): TripPlace {
  const code = city.country.toUpperCase();
  return replacePlace(place, {
    name: city.name,
    state: city.region || place.state,
    countryCode: code,
    country: countryName(code),
    coords: { lat: city.lat, lon: city.lon },
    source: 'search',
  });
}

/** The stages with these picks written — one change, so ⌘Z takes them all back. */
export function applyIndexPicks(stages: readonly TripStage[], picks: readonly IndexPick[]): TripStage[] {
  if (!picks.length) return [...stages];
  const byPlace = new Map(picks.map((p) => [p.placeId, p]));
  return stages.map((stage) => {
    if (!stage.places?.some((p) => byPlace.has(p.id))) return stage;
    return {
      ...stage,
      places: stage.places.map((p) => {
        const pick = byPlace.get(p.id);
        return pick && pick.stageId === stage.id ? placeAtCity(p, pick.city) : p;
      }),
    };
  });
}
