/**
 * The recap's PLACES (lab 9's B + lab 11, his yes of 2026-11-07): the town a
 * picture was taken in, said with ONE mark — the Maps pin, a teardrop in the
 * accent — wherever a place is said: a glass pill in a cell's corner, the head
 * of a run of days on a calendar, a title's `{place}`.
 *
 * - On the cells (`cells`): off, or only where the place CHANGES from the
 *   cell before (a route read at a glance), on every cell, or on the first
 *   picture of each place.
 * - Runs of days (`runs`): off until he turns them on.
 *
 * The place is Winnow's geocoding (`RecapPicture.place/region/country`), read
 * at fill: a picture without it says nothing — unless he gives it one by hand
 * (lab 17 part III): written into those same three fields, so every reader
 * (Wrapped, the Badge, the caption's tags, the agent's pool) sees it, Winnow's
 * own kept in `placeWinnow` to give back.
 * - How it is WRITTEN (`writing`): Trips' four writings, the same official
 *   state codes (`place-style.ts`) — «Albany», «Albany, WA», «Albany, Western
 *   Australia», «Albany (WA)»; and the COUNTRY never, where it changes, always.
 *
 * Pure and DOM-free.
 */

import type { RecapDoc, RecapPicture } from './recap-doc';
import { countryName, writePlace } from '../roadtrip/place-style';
import type { PlaceStyle, TripDoc } from '../roadtrip/trip-types';

export type PlaceMarks = 'off' | 'changes' | 'every' | 'first';
export const PLACE_MARKS: readonly PlaceMarks[] = ['off', 'changes', 'every', 'first'];

export type PinCorner = 'bottomLeft' | 'topLeft' | 'topRight' | 'bottomRight';
export const PIN_CORNERS: readonly PinCorner[] = ['bottomLeft', 'topLeft', 'topRight', 'bottomRight'];

export interface RecapPlaces {
  /** Which cells wear the pill. */
  cells: PlaceMarks;
  /** The cell's corner the pill sits in. */
  corner: PinCorner;
  /** A month's or a week's runs of days in one place, under the calendar — off until he turns them on. */
  runs: boolean;
  /** `{place}` in a text leads with the pin. */
  titlePin: boolean;
  /** How a place is written — Trips' writings (lab 17 part III); `name` is what the pill always said. */
  writing: PlaceStyle;
  /** The country after the place: never, on the first pill and again after a border, or on every pill. */
  country: PlaceCountry;
}

export type PlaceCountry = 'never' | 'changes' | 'always';
export const PLACE_COUNTRIES: readonly PlaceCountry[] = ['never', 'changes', 'always'];
export const PLACE_WRITINGS: readonly PlaceStyle[] = ['name', 'code', 'full', 'paren'];

export const DEFAULT_PLACES: RecapPlaces = { cells: 'off', corner: 'bottomLeft', runs: false, titlePin: true, writing: 'name', country: 'never' };

export function readPlaces(raw: unknown): RecapPlaces {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    cells: PLACE_MARKS.includes(r.cells as PlaceMarks) ? (r.cells as PlaceMarks) : DEFAULT_PLACES.cells,
    corner: PIN_CORNERS.includes(r.corner as PinCorner) ? (r.corner as PinCorner) : DEFAULT_PLACES.corner,
    runs: typeof r.runs === 'boolean' ? r.runs : DEFAULT_PLACES.runs,
    titlePin: typeof r.titlePin === 'boolean' ? r.titlePin : DEFAULT_PLACES.titlePin,
    writing: PLACE_WRITINGS.includes(r.writing as PlaceStyle) ? (r.writing as PlaceStyle) : DEFAULT_PLACES.writing,
    country: PLACE_COUNTRIES.includes(r.country as PlaceCountry) ? (r.country as PlaceCountry) : DEFAULT_PLACES.country,
  };
}

/** What a place is made of: the town (or sight), its region, its country — Winnow's three fields, or his. */
export type PlaceFacts = Pick<RecapPicture, 'place' | 'region' | 'country'>;

/**
 * A place in the recap's writing: the town with its region as Trips writes it
 * («Albany, WA» — the official code, else one derived from the name; a
 * writing that asks for what the place lacks degrades, never a dangling
 * comma); a place with no town says its region, else its country.
 */
export function writtenPlace(p: PlaceFacts | null | undefined, writing: PlaceStyle): string | null {
  if (!p) return null;
  const town = p.place?.trim();
  if (!town) return p.region?.trim() || p.country?.trim() || null;
  return writePlace({ name: town, state: p.region?.trim() ?? '' }, writing, { stateCodes: {} }) || town;
}

/** True when the place a picture says was given by hand (Winnow's kept beside it). */
export const isPlaceByHand = (p: Pick<RecapPicture, 'placeWinnow'>) => p.placeWinnow !== undefined;

/**
 * Pictures given a place by hand — or, with null, given back Winnow's. The
 * first hand place keeps what Winnow said (`placeWinnow`, empty when it said
 * nothing); a second hand place keeps that same original.
 */
export function withPlaceByHand(doc: RecapDoc, keys: readonly string[], place: PlaceFacts | null, now: number = Date.now()): RecapDoc {
  const set = new Set(keys);
  let hit = false;
  const clean = (v: string | undefined) => v?.trim().slice(0, 120) || undefined;
  const pictures = doc.pictures.map((p) => {
    if (!set.has(p.key)) return p;
    const { place: _p, region: _r, country: _c, placeWinnow, ...rest } = p;
    void _p;
    void _r;
    void _c;
    if (place === null) {
      if (!placeWinnow) return p;
      hit = true;
      return { ...rest, ...strip(placeWinnow) };
    }
    const town = clean(place.place);
    const region = clean(place.region);
    const country = clean(place.country);
    if (!town && !region && !country) return p;
    hit = true;
    return { ...rest, ...strip({ place: town, region, country }), placeWinnow: placeWinnow ?? strip({ place: p.place, region: p.region, country: p.country }) };
  });
  // `withRecap`'s stamp, written here: a value import of `recap-doc.ts` would be a cycle (it reads its places from here).
  return hit ? { ...doc, pictures, updatedAt: Math.max(now, doc.updatedAt + 1) } : doc;
}

function strip(p: PlaceFacts): PlaceFacts {
  const out: PlaceFacts = {};
  if (p.place) out.place = p.place;
  if (p.region) out.region = p.region;
  if (p.country) out.country = p.country;
  return out;
}

/** The places the recap's pictures know, the most pictured first — what a picture without one is offered. */
export function knownPlaces(pictures: readonly PlaceFacts[], max = 8): PlaceFacts[] {
  const by = new Map<string, { p: PlaceFacts; n: number }>();
  for (const p of pictures) {
    const name = placeName(p);
    if (!name) continue;
    const k = `${name}|${p.region ?? ''}|${p.country ?? ''}`;
    const cur = by.get(k);
    if (cur) cur.n++;
    else by.set(k, { p: strip({ place: p.place, region: p.region, country: p.country }), n: 1 });
  }
  return [...by.values()].sort((a, b) => b.n - a.n || placeName(a.p)!.localeCompare(placeName(b.p)!)).slice(0, max).map((x) => x.p);
}

/** A trip's places as a picture can take them: its name, its state (else its stage's region), its country's name — each once, in the trip's order. */
export function tripPlaceFacts(trip: Pick<TripDoc, 'stages'> | null | undefined): PlaceFacts[] {
  const out: PlaceFacts[] = [];
  const seen = new Set<string>();
  for (const stage of trip?.stages ?? []) {
    for (const p of stage.places) {
      const name = p.name.trim();
      if (!name) continue;
      const facts = strip({ place: name, region: p.state.trim() || stage.region?.trim() || undefined, country: p.countryCode ? countryName(p.countryCode) : undefined });
      const k = `${name}|${facts.region ?? ''}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(facts);
      }
    }
  }
  return out;
}

/** The other pictures of `key`'s day that a hand place would reach: those with no place, and those already given the same one by hand. */
export function dayMates(doc: RecapDoc, key: string): { without: string[]; same: string[] } {
  const me = doc.pictures.find((p) => p.key === key);
  if (!me?.day) return { without: [], same: [] };
  const name = placeName(me);
  const without: string[] = [];
  const same: string[] = [];
  for (const p of doc.pictures) {
    if (p.key === key || p.loose || p.day !== me.day) continue;
    if (!placeName(p)) without.push(p.key);
    else if (isPlaceByHand(p) && placeName(p) === name && p.region === me.region && p.country === me.country) same.push(p.key);
  }
  return { without, same };
}

/** The private-use character a text carries where the pin is drawn (`{place}` filled with the pin). */
export const PIN = '';

/** The name a pill says: the town, else the region, else the country; null when Winnow named nothing. */
export function placeName(p: Pick<RecapPicture, 'place' | 'region' | 'country'> | null | undefined): string | null {
  if (!p) return null;
  return p.place?.trim() || p.region?.trim() || p.country?.trim() || null;
}

/**
 * The cells that wear the pill, by id, with the name it says — `cells` in
 * the order a person reads them (page after page, cell after cell). A cell
 * with no picture, or a picture with no place, is skipped and breaks nothing:
 * «where it changes» compares with the last cell that SAID a place.
 */
export function placeMarks(
  cells: readonly { id: string; place: string | null; written?: string | null; country?: string | null }[],
  mode: PlaceMarks,
  country: PlaceCountry = 'never',
): Map<string, string> {
  const out = new Map<string, string>();
  if (mode === 'off') return out;
  const seen = new Set<string>();
  let last: string | null = null;
  let lastCountry: string | null = null;
  for (const c of cells) {
    if (!c.place || out.has(c.id)) continue;
    const show = mode === 'every' || (mode === 'changes' && c.place !== last) || (mode === 'first' && !seen.has(c.place));
    if (show) {
      // The country: on every pill, or on the first and again after a border (compared with the last pill said).
      const land = c.country?.trim() || null;
      const withLand = land && land !== c.place && (country === 'always' || (country === 'changes' && land !== lastCountry));
      out.set(c.id, `${c.written || c.place}${withLand ? ` · ${land}` : ''}`);
      if (land) lastCountry = land;
    }
    seen.add(c.place);
    last = c.place;
  }
  return out;
}

/**
 * The words a text can hold (`{place}`, `{places}`), counted from the
 * recap's pictures: the place he came back to most — the most DAYS, then the
 * most pictures (Wrapped's rule) — and the route, its places in time order,
 * each said once per stay. Null and empty when Winnow named none.
 */
export function placeWords(
  pictures: readonly Pick<RecapPicture, 'day' | 'minute' | 'second' | 'place' | 'region' | 'country'>[],
  writing: PlaceStyle = 'name',
): { place: string | null; route: string[]; written: string | null } {
  const days = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  const timed: { at: string; name: string }[] = [];
  for (const p of pictures) {
    const name = placeName(p);
    if (!name) continue;
    days.set(name, (days.get(name) ?? new Set()).add(p.day ?? ''));
    counts.set(name, (counts.get(name) ?? 0) + 1);
    const secs = p.second ?? (p.minute !== undefined ? p.minute * 60 : 43200);
    timed.push({ at: `${p.day ?? ''}T${String(Math.round(secs)).padStart(5, '0')}`, name });
  }
  let place: string | null = null;
  let best = -1;
  for (const [name, d] of days) {
    const score = d.size * 100_000 + (counts.get(name) ?? 0);
    if (score > best || (score === best && place !== null && name.localeCompare(place) < 0)) {
      best = score;
      place = name;
    }
  }
  const route: string[] = [];
  for (const { name } of timed.sort((a, b) => a.at.localeCompare(b.at))) if (route[route.length - 1] !== name) route.push(name);
  // `{place}` in the recap's writing, from a picture that says it; the route stays bare names.
  const written = place ? writtenPlace(pictures.find((p) => placeName(p) === place), writing) : null;
  return { place, route, written };
}

/** The route as a text says it: `Esperance → Albany → Perth`; past five, its first three, an ellipsis and its last. */
export function routeLine(route: readonly string[]): string {
  if (route.length <= 5) return route.join(' → ');
  return [...route.slice(0, 3), '…', route[route.length - 1]].join(' → ');
}

/** A run of days in one place: its place and the first and last positions (in the list given) of the days it holds. */
export interface PlaceRun {
  place: string;
  from: number;
  to: number;
}

/**
 * The runs of days spent in one place, over `days` in calendar order. A day
 * with no picture (or no place) between two days of the same place joins the
 * run; between two places it belongs to neither — a run starts and ends on a
 * day that said it.
 */
export function placeRuns(days: readonly (string | null)[]): PlaceRun[] {
  const out: PlaceRun[] = [];
  for (let i = 0; i < days.length; i++) {
    const place = days[i];
    if (!place) continue;
    const cur = out[out.length - 1];
    if (cur && cur.place === place) cur.to = i;
    else out.push({ place, from: i, to: i });
  }
  return out;
}
