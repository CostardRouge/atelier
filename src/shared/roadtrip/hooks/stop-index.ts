/**
 * What the shipped TOWN INDEX can tell a stop about where it is — its state
 * and its country — so a stop picked on a map is written «Sydney, NSW» like
 * a place of the trip (`docs/map-openers-next.md` §1: «filled … where it can
 * be read, from the town index»).
 *
 * The index is the gazetteer every offline name of the suite comes from
 * (`gazetteer.ts`): a town's record carries its first administrative
 * subdivision (`region`) and its country. Nothing is fetched here and nothing
 * leaves the machine; this module is pure and is handed the cities.
 *
 * **Only what the index says without doubt** — the rule of the overview's
 * «Place it» (`place-locate.ts`), met once more:
 * - a stop whose NAME is a town of the index lying within {@link SAME_TOWN_KM}
 *   of the stop takes that town's state and country — a town over a suburb of
 *   the same name, then the nearest;
 * - else a stop standing AT a town (one within {@link AT_TOWN_KM}) takes the
 *   state every town within {@link AROUND_KM} agrees on — and nothing when two
 *   states share that circle, which is what keeps Coolangatta out of New
 *   South Wales;
 * - a fact the stop already has is never overwritten, and a stop whose own
 *   state or country contradicts the town's takes nothing at all.
 */

import type { GazetteerCity } from '../gazetteer';
import { countryName } from '../place-style';
import { officialStateCode } from '../state-codes';
import { haversineKm, type GeoPoint } from './geo';
import type { HookPlace } from './hook-variant';

/** How far a town of the stop's own name may lie and still be the stop. */
export const SAME_TOWN_KM = 15;
/** How near a town a nameless or unindexed stop must stand to be read at all… */
export const AT_TOWN_KM = 10;
/** …and the circle every town of which must lie in one state. */
export const AROUND_KM = 25;

const KM_PER_DEGREE = 111.32;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/** What a town of the index says of where it is — a map's `Town` may carry it too. */
export type TownFacts = Partial<Pick<GazetteerCity, 'region' | 'country'>>;

/** The facts a town of the index carries, as a place's keys — never an empty one. */
export function cityFacts(city: TownFacts): Partial<HookPlace> {
  const code = (city.country ?? '').trim().toUpperCase();
  const region = (city.region ?? '').trim();
  return {
    ...(region ? { state: region } : {}),
    ...(code ? { countryCode: code, country: countryName(code) } : {}),
  };
}

/** A town of the index as a place to ADD: its name, its position and its facts. */
export function cityPlace(city: GeoPoint & { name: string } & TownFacts): HookPlace {
  return { name: city.name, lat: city.lat, lon: city.lon, ...cityFacts(city) };
}

/** Whether a state the place wrote is the town's — in full or as its official code. */
function sameState(written: string, region: string, country: string): boolean {
  const want = fold(written);
  if (!want || fold(region) === want) return true;
  const code = officialStateCode(region, country);
  return !!code && fold(code) === want;
}

/**
 * The place with the town's facts written where it had none. A place whose
 * own country or state says otherwise is returned as it was: the author's
 * word stands, and a half-filled contradiction would be worse than nothing.
 */
export function withCityFacts<P extends HookPlace>(place: P, city: TownFacts): P {
  const facts = cityFacts(city);
  const ownCountry = (place.countryCode ?? '').trim().toUpperCase();
  if (ownCountry && facts.countryCode && ownCountry !== facts.countryCode) return place;
  const ownState = (place.state ?? '').trim();
  if (ownState && facts.state && !sameState(ownState, facts.state, facts.countryCode ?? ownCountry)) return place;
  const next = { ...place };
  if (!ownState && facts.state) next.state = facts.state;
  if (!ownCountry && facts.countryCode) {
    next.countryCode = facts.countryCode;
    if (!(place.country ?? '').trim() && facts.country) next.country = facts.country;
  }
  return next;
}

/**
 * The index's towns by their folded name, read ONCE for a whole list: folding
 * 135 000 names for each of a hundred stops would hold the page for seconds.
 */
export type TownNames = Map<string, GazetteerCity[]>;

export function townNames(cities: readonly GazetteerCity[]): TownNames {
  const out: TownNames = new Map();
  for (const city of cities) {
    const key = fold(city.name);
    const list = out.get(key);
    if (list) list.push(city);
    else out.set(key, [city]);
  }
  return out;
}

/** The town of the index this place IS by its name — within {@link SAME_TOWN_KM}, a town over a suburb. */
export function townNamed(
  cities: readonly GazetteerCity[],
  place: GeoPoint & { name: string },
  names?: TownNames,
): GazetteerCity | null {
  const key = fold(place.name);
  if (!key) return null;
  const pool = names ? (names.get(key) ?? []) : cities.filter((c) => fold(c.name) === key);
  const near = pool
    .map((city) => ({ city, km: haversineKm(place, city) }))
    .filter((h) => h.km <= SAME_TOWN_KM)
    .sort((a, b) => a.km - b.km);
  if (!near.length) return null;
  return (near.find((h) => !h.city.section) ?? near[0]).city;
}

/** Every town of the index within `km` of a point, nearest first. */
function townsWithin(cities: readonly GazetteerCity[], point: GeoPoint, km: number): { city: GazetteerCity; km: number }[] {
  const latWindow = km / KM_PER_DEGREE;
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  const lonWindow = cosLat > 0.02 ? km / (KM_PER_DEGREE * cosLat) : 181;
  const out: { city: GazetteerCity; km: number }[] = [];
  for (const city of cities) {
    if (Math.abs(city.lat - point.lat) > latWindow) continue;
    const gap = Math.abs(city.lon - point.lon) % 360;
    if (lonWindow <= 180 && (gap > 180 ? 360 - gap : gap) > lonWindow) continue;
    const d = haversineKm(point, city);
    if (d <= km) out.push({ city, km: d });
  }
  return out.sort((a, b) => a.km - b.km);
}

/**
 * The state and country a point lies in, when the index says so without
 * doubt: a town within {@link AT_TOWN_KM}, and every town within
 * {@link AROUND_KM} in that one state. Null otherwise.
 */
export function regionAround(
  cities: readonly GazetteerCity[],
  point: GeoPoint,
): Pick<GazetteerCity, 'region' | 'country'> | null {
  const around = townsWithin(cities, point, AROUND_KM);
  if (!around.length || around[0].km > AT_TOWN_KM) return null;
  const first = around[0].city;
  if (!first.regionKey || !first.region.trim()) return null;
  return around.every((t) => t.city.regionKey === first.regionKey) ? { region: first.region, country: first.country } : null;
}

/**
 * Whether a place still lacks a fact the index could give it. A place with
 * no NAME is not counted: it writes nothing, so a state would say nothing —
 * and a stop dropped on the map is named first (the big map offers a town).
 */
export function lacksIndexFacts(place: HookPlace): boolean {
  if (!place.name.trim()) return false;
  return !(place.state ?? '').trim() || !(place.countryCode ?? '').trim();
}

/**
 * The place with what the index says of it written in, or null when the
 * index cannot say without doubt — or has nothing the place lacks.
 */
export function placeFromIndex<P extends HookPlace>(
  place: P,
  cities: readonly GazetteerCity[],
  names?: TownNames,
): P | null {
  if (!lacksIndexFacts(place)) return null;
  const source = townNamed(cities, place, names) ?? regionAround(cities, place);
  if (!source) return null;
  const next = withCityFacts(place, source);
  return next.state !== place.state || next.countryCode !== place.countryCode ? next : null;
}

/**
 * Every stop that lacks its state or country, filled from the index where it
 * answers without doubt — ONE list, so the edit is one step to undo. `left`
 * counts the stops that still lack one.
 */
export function fillFromIndex<P extends HookPlace>(
  places: readonly P[],
  cities: readonly GazetteerCity[],
): { places: P[]; filled: number; left: number } {
  let filled = 0;
  let left = 0;
  const names = places.some(lacksIndexFacts) ? townNames(cities) : undefined;
  const out = places.map((place) => {
    if (!lacksIndexFacts(place)) return place;
    const next = placeFromIndex(place, cities, names);
    if (next) filled += 1;
    if (lacksIndexFacts(next ?? place)) left += 1;
    return next ?? place;
  });
  return { places: out, filled, left };
}

/** What a fill did, in one line — said under the list that asked for it. */
export function fillSummary(filled: number, left: number): string {
  const did = filled
    ? `${filled} ${filled === 1 ? 'stop learnt its' : 'stops learnt their'} state from the town index.`
    : 'The town index placed no stop without doubt.';
  return left ? `${did} ${left} ${left === 1 ? 'is' : 'are'} left to you — a border, no town near, or no name.` : did;
}

/** How many stops do not say their state, in one line — what the fill verb sits beside. */
export function lackingLine(lacking: number, total: number): string {
  if (lacking >= total) return total === 1 ? 'The stop does not say its state.' : 'No stop says its state.';
  return `${lacking} of ${total} stops ${lacking === 1 ? 'does not say its' : 'do not say their'} state.`;
}
