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
