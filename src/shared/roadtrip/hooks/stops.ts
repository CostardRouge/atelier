/**
 * The author's own STOPS — the places a map opener is given by hand, whether
 * or not the trip's legs name them. Both map openers read them: the Itinerary
 * draws its pen through them, Virée drives its car through them when its stops
 * are «your places» (2026-09-28). What two variants both want lives beside the
 * contract, never in either — the `easing.ts` / `tick-kits.ts` rule — so this
 * is the model and its edits, and `map-plan.ts` re-exports the names it grew
 * them under.
 *
 * A stop is the author's own assertion: a place, in the order they chose,
 * optionally holding one picture. Nothing here is derived, so nothing here is
 * invented. Pure and DOM-free.
 */

import type { PlaceResult } from '../../map/geocode';
import { DEFAULT_PLACE_STYLE, writePlace, type PlaceWritingTrip } from '../place-style';
import type { PlaceStyle } from '../trip-types';
import type { GeoPoint } from './geo';
import type { HookPickedPicture, HookPlace, HookStage } from './hook-variant';

/**
 * One place the author put on the map, with the picture they gave it — and,
 * since 2026-10-07, what it KNOWS of where it is (`HookPlace`: the state,
 * its code, the country), so it is written «Sydney, NSW» like any place of
 * the suite. A stop stored before that day knows only its name and still
 * reads as it did.
 */
export interface MapStop extends HookPlace {
  /** Stable across edits — the React key, and what a reorder moves. */
  id: string;
  /** The one picture this stop shows, or nothing. */
  picture?: HookPickedPicture;
  /**
   * How many of the author's stops this one stands for, once nearby places
   * are GROUPED at render time (`stop-clusters.ts`) — on a prepared copy
   * only, never stored: `readStops` does not read it.
   */
  members?: number;
}

/** The facts a stop may know beside its name and position, as stored keys. */
const PLACE_FACTS = ['state', 'area', 'stateCode', 'searchCode', 'country', 'countryCode'] as const;
const PLACE_STYLES: readonly PlaceStyle[] = ['code', 'full', 'paren', 'name'];

/** Only the facts a place HAS: an empty string is never stored, a code is upper case. */
function placeFacts(from: Partial<HookPlace>): Partial<HookPlace> {
  const out: Partial<HookPlace> = {};
  for (const key of PLACE_FACTS) {
    const value = typeof from[key] === 'string' ? from[key].trim() : '';
    if (value) out[key] = key === 'countryCode' ? value.toUpperCase() : value;
  }
  if (from.style && PLACE_STYLES.includes(from.style)) out.style = from.style;
  return out;
}

/** How an opener writes its stops: like the trip's badges, or one writing of its own. */
export type StopStyle = 'trip' | PlaceStyle;
export const STOP_STYLES: readonly StopStyle[] = ['trip', ...PLACE_STYLES];

/**
 * A place as an opener or a list WRITES it — «Sydney, NSW», «Sydney, New
 * South Wales», «Sydney (NSW)» or «Sydney» — through the suite's one cascade
 * (`place-style.ts`): the place's own writing, else the opener's, else the
 * trip's for a badge. A place that knows no state is its name, whatever the
 * writing asks; nothing is invented.
 */
export function stopText(place: HookPlace, style: StopStyle = 'trip', writing?: PlaceWritingTrip): string {
  const trip = { placeStyle: writing?.placeStyle ?? DEFAULT_PLACE_STYLE, stateCodes: writing?.stateCodes ?? {} };
  const chosen = place.style ?? (style === 'trip' ? trip.placeStyle.badge : style);
  return writePlace(
    { name: place.name, state: place.state ?? '', stateCode: place.stateCode, searchCode: place.searchCode },
    chosen,
    trip,
  );
}

/** The stops with their names WRITTEN — what an opener paints and captions with. */
export function writtenStops<S extends HookPlace>(stops: readonly S[], style: StopStyle, writing?: PlaceWritingTrip): S[] {
  return stops.map((stop) => ({ ...stop, name: stopText(stop, style, writing) }));
}

/**
 * What a stop takes from a search's answer — the rule of `adoptSearchResult`
 * (`place-search.ts`): the name and the position are the answer's, a state
 * the author typed is never overwritten, a fact the stop lacked is filled,
 * and the search's own code is always the latest answer's.
 */
export function adoptSearch(stop: MapStop, result: PlaceResult): MapStop {
  const next: MapStop = { ...stop, name: result.name, lat: result.lat, lon: result.lon };
  const facts = placeFacts({
    state: (stop.state ?? '').trim() || result.state || result.region,
    area: (stop.area ?? '').trim() || result.area,
    country: (stop.country ?? '').trim() || result.country,
    countryCode: (stop.countryCode ?? '').trim() || result.countryCode,
    searchCode: result.stateCode,
  });
  for (const key of PLACE_FACTS) {
    if (facts[key]) next[key] = facts[key];
    else if (key === 'searchCode') delete next.searchCode;
  }
  return next;
}

/** A search's answer as a place to ADD — every fact it carries. */
export function searchPlace(result: PlaceResult): HookPlace {
  return {
    name: result.name,
    lat: result.lat,
    lon: result.lon,
    ...placeFacts({
      state: result.state || result.region,
      area: result.area,
      country: result.country,
      countryCode: result.countryCode,
      searchCode: result.stateCode,
    }),
  };
}

/**
 * How much smaller a stop's NUMERAL is drawn, so it stays inside its dot.
 *
 * Every dot that carries a number — the opener's, the panel's small map's,
 * the big map's markers — was sized for two digits, and the list once
 * stopped at 99 for exactly that reason. A list has no cap since 2026-10-07
 * (the maintainer: «moi j'en avais 120, ça a été coupé à 99 … pas de
 * limite»), so a numeral of three digits or more shrinks instead: its width
 * stays that of a 2.3-digit numeral at full size, which a disc holds with
 * room on both sides. Two digits and fewer are drawn exactly as before.
 */
export function numeralScale(n: number): number {
  const digits = String(Math.trunc(Math.abs(n)) || 1).length;
  return Math.min(1, 2.3 / digits);
}

/**
 * A stored picture reference, read defensively: it travels in `.roadtrip.json`
 * and may have been written by a newer build. Anything that cannot name a file
 * again is dropped — a stop then simply has no picture, which is a state the
 * paint already draws.
 */
function readPicture(raw: unknown): HookPickedPicture | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const ref = p.ref as Record<string, unknown> | undefined;
  if (!ref || typeof ref !== 'object' || typeof ref.name !== 'string' || !ref.name) return undefined;
  const date = typeof p.date === 'string' ? p.date : '';
  const takenAt = Number(p.takenAt);
  return {
    ref: ref as unknown as HookPickedPicture['ref'],
    date,
    ...(Number.isFinite(takenAt) ? { takenAt } : {}),
  };
}

/** Stored stops, read through the same discipline as the rest of the options. */
export function readStops(raw: unknown): MapStop[] {
  if (!Array.isArray(raw)) return [];
  const out: MapStop[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const s = row as Record<string, unknown>;
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    // A place with no coordinates is a complete place everywhere else in this
    // tool; it simply cannot be a point on a map.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({
      id: typeof s.id === 'string' && s.id ? s.id : `stop${out.length}`,
      name: typeof s.name === 'string' ? s.name : '',
      lat,
      lon,
      ...placeFacts(s as Partial<HookPlace>),
      picture: readPicture(s.picture),
    });
  }
  return out;
}

/**
 * The trip's own located places that are NOT already stops, for the faint
 * context layer and for the panel's "add a place" chips. Matched on position
 * rather than on name: the same place typed twice is one place.
 */
export function otherPlaces(stages: readonly HookStage[] | undefined, stops: readonly MapStop[]): HookPlace[] {
  const out: HookPlace[] = [];
  for (const stage of stages ?? []) {
    for (const place of stage.places) {
      if (samePlace(stops, place) || out.some((seen) => near(seen, place))) continue;
      out.push({ ...place });
    }
  }
  return out;
}

function near(a: GeoPoint, b: GeoPoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
}

function samePlace(stops: readonly MapStop[], place: GeoPoint): boolean {
  return stops.some((stop) => near(stop, place));
}

// ---------------------------------------------------------------------------
// Editing the stops — pure, so the panels only draw
// ---------------------------------------------------------------------------

/** A stop added at the end, with whatever the place knows. The name is the author's to write. */
export function addStop(stops: readonly MapStop[], at: GeoPoint & Partial<HookPlace>, id: string): MapStop[] {
  return [...stops, { id, name: at.name ?? '', lat: at.lat, lon: at.lon, ...placeFacts(at) }];
}

/**
 * A stop GIVEN another place — one of the trip's landmarks taken from the
 * mini map, say: the place's name, position and facts replace the stop's
 * (its old facts were the old place's), the id and the picture stay.
 */
export function replaceStopPlace(stops: readonly MapStop[], id: string, place: HookPlace): MapStop[] {
  return stops.map((stop) =>
    stop.id === id
      ? { id: stop.id, name: place.name, lat: place.lat, lon: place.lon, ...placeFacts(place), ...(stop.picture ? { picture: stop.picture } : {}) }
      : stop,
  );
}

/**
 * Whether two stops are the same place said the same way — id, position,
 * name, writing and every fact. What the big map's Done compares, so a state
 * learnt from the town index counts as a change.
 */
export function sameStopPlace(a: MapStop, b: MapStop): boolean {
  return (
    a.id === b.id &&
    a.lat === b.lat &&
    a.lon === b.lon &&
    a.name === b.name &&
    a.style === b.style &&
    PLACE_FACTS.every((key) => (a[key] ?? '') === (b[key] ?? ''))
  );
}

/** One stop changed in place; everything else, including its picture, kept. */
export function patchStop(
  stops: readonly MapStop[],
  id: string,
  patch: Partial<Omit<MapStop, 'id'>>,
): MapStop[] {
  return stops.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop));
}

export function removeStop(stops: readonly MapStop[], id: string): MapStop[] {
  return stops.filter((stop) => stop.id !== id);
}

/** A stop moved one place earlier or later. Out of range is a no-op, not a wrap. */
export function moveStop(stops: readonly MapStop[], id: string, delta: number): MapStop[] {
  const from = stops.findIndex((stop) => stop.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= stops.length) return [...stops];
  const out = [...stops];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/**
 * A stop moved to a place in the order — a DRAG's landing in the list, where
 * {@link moveStop} is the arrows' one step. `index` is where it ends up, read
 * in the list it ends up in; past either end means first or last.
 */
export function moveStopTo(stops: readonly MapStop[], id: string, index: number): MapStop[] {
  const from = stops.findIndex((stop) => stop.id === id);
  if (from < 0 || !Number.isFinite(index)) return [...stops];
  const to = Math.max(0, Math.min(stops.length - 1, Math.trunc(index)));
  const out = [...stops];
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/**
 * The pictures the chooser came back with, landing on the stops.
 *
 * The first goes to the stop the author asked from. The rest fill the stops
 * AFTER it that have none — never one that already holds a picture, so a
 * generous pick can never quietly undo earlier work, and never a stop before
 * the one asked from, which would edit behind the author's back. Anything left
 * over is reported by the panel rather than dropped in silence.
 */
export function assignPictures(
  stops: readonly MapStop[],
  index: number,
  picked: readonly HookPickedPicture[],
): { stops: MapStop[]; used: number } {
  const out = stops.map((stop) => ({ ...stop }));
  if (index < 0 || index >= out.length) return { stops: out, used: 0 };
  if (picked.length === 0) {
    // An empty pick is "this stop shows nothing" — the way to take a picture
    // off a stop from inside the chooser.
    delete out[index].picture;
    return { stops: out, used: 0 };
  }
  out[index].picture = picked[0];
  let used = 1;
  for (let i = index + 1; i < out.length && used < picked.length; i++) {
    if (out[i].picture) continue;
    out[i].picture = picked[used];
    used += 1;
  }
  return { stops: out, used };
}

/** The trip's own located places as an itinerary — the one-click start. */
export function stopsFromPlaces(places: readonly HookPlace[], makeId: (index: number) => string): MapStop[] {
  return places.map((place, i) => ({ id: makeId(i), name: place.name, lat: place.lat, lon: place.lon, ...placeFacts(place) }));
}

/** Every located place of the trip, in the order it was lived. */
export function tripPlaces(stages: readonly HookStage[] | undefined): HookPlace[] {
  const out: HookPlace[] = [];
  for (const stage of stages ?? []) {
    for (const place of stage.places) {
      if (out.some((seen) => near(seen, place))) continue;
      out.push({ ...place });
    }
  }
  return out;
}
