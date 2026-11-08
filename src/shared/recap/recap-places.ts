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
 * at fill: a picture without it says nothing.
 *
 * Pure and DOM-free.
 */

import type { RecapPicture } from './recap-doc';

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
}

export const DEFAULT_PLACES: RecapPlaces = { cells: 'off', corner: 'bottomLeft', runs: false, titlePin: true };

export function readPlaces(raw: unknown): RecapPlaces {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    cells: PLACE_MARKS.includes(r.cells as PlaceMarks) ? (r.cells as PlaceMarks) : DEFAULT_PLACES.cells,
    corner: PIN_CORNERS.includes(r.corner as PinCorner) ? (r.corner as PinCorner) : DEFAULT_PLACES.corner,
    runs: typeof r.runs === 'boolean' ? r.runs : DEFAULT_PLACES.runs,
    titlePin: typeof r.titlePin === 'boolean' ? r.titlePin : DEFAULT_PLACES.titlePin,
  };
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
export function placeMarks(cells: readonly { id: string; place: string | null }[], mode: PlaceMarks): Map<string, string> {
  const out = new Map<string, string>();
  if (mode === 'off') return out;
  const seen = new Set<string>();
  let last: string | null = null;
  for (const c of cells) {
    if (!c.place || out.has(c.id)) continue;
    const show = mode === 'every' || (mode === 'changes' && c.place !== last) || (mode === 'first' && !seen.has(c.place));
    if (show) out.set(c.id, c.place);
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
export function placeWords(pictures: readonly Pick<RecapPicture, 'day' | 'minute' | 'second' | 'place' | 'region' | 'country'>[]): { place: string | null; route: string[] } {
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
  return { place, route };
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
