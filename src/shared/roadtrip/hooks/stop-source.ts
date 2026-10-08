/**
 * Where an opener's STOPS come from (2026-10-08, his «les mêmes options de
 * sélection des points que Virée»): the trip's LEGS (their located places,
 * up to the piece's day), the author's OWN map (`stops`, the list the
 * editor writes), or the picked PHOTOS' own positions. Virée had the three;
 * the Itinerary and the Recap card read them through here, so a list is the
 * same whichever opener draws it.
 *
 * The legs and the photos are resolved by Virée's own route
 * (`driveRoute`), then read back as the editor's stops: a name, a position,
 * the place's facts where it is a place, and its first picture. Editing such
 * a list makes it the author's own (`ownStops`).
 */

import { DRIVE_DEFAULTS, driveOptions, driveRoute, type DriveStop } from './drive-plan';
import type { HookContext, HookPickedPicture } from './hook-variant';
import { readPicked } from './picked';
import { readStops, type MapStop } from './stops';

export type StopSource = 'places' | 'custom' | 'pictures';
export const STOP_SOURCES: readonly StopSource[] = ['places', 'custom', 'pictures'];

/** The keys an opener stores its stops' source in — the same names as Virée's. */
export interface StopSourceOptions {
  stopsOn: StopSource;
  stops: readonly MapStop[];
  picked: readonly HookPickedPicture[];
  /** On the legs: also the picture of each day already told. */
  includePieces: boolean;
}

/** The source in a stored record, `fallback` where it says nothing — the Itinerary's own map, the card's legs. */
export function readStopSource(raw: Readonly<Record<string, unknown>>, fallback: StopSource): StopSourceOptions {
  return {
    stopsOn: STOP_SOURCES.includes(raw.stopsOn as StopSource) ? (raw.stopsOn as StopSource) : fallback,
    stops: readStops(raw.stops),
    picked: readPicked(raw.picked),
    includePieces: raw.includePieces !== false,
  };
}

/** One of Virée's stops read back as the editor's: the place it is, its position, its first picture. */
export function mapStopOf(stop: DriveStop, id: string): MapStop {
  const source = stop.source;
  const picture = stop.pictures[0];
  const facts = source
    ? Object.fromEntries(
        (['state', 'area', 'stateCode', 'searchCode', 'country', 'countryCode', 'style', 'arrived', 'left'] as const)
          .filter((key) => source[key] !== undefined)
          .map((key) => [key, source[key]]),
      )
    : {};
  return {
    ...facts,
    id,
    name: (stop.place ?? stop.name).trim(),
    lat: stop.lat,
    lon: stop.lon,
    ...(picture ? { picture: { ref: picture.want.ref, date: picture.date ?? '' } } : {}),
  };
}

/**
 * The stops a source gives on this piece: the author's own list as it is,
 * or the legs' places / the photos' positions, with their pictures.
 */
export function sourceStops(
  o: StopSourceOptions,
  ctx: Pick<HookContext, 'stages' | 'calendar' | 'date' | 'writing'>,
): MapStop[] {
  if (o.stopsOn === 'custom') return [...o.stops];
  const route = driveRoute(
    ctx.stages ?? [],
    ctx.calendar ?? [],
    ctx.date,
    driveOptions({ ...DRIVE_DEFAULTS, stopsOn: o.stopsOn, picked: o.picked, includePieces: o.includePieces, pictures: 'cards', groupKm: 0 }),
    ctx.writing,
  );
  return route.stops.map((stop, i) => mapStopOf(stop, `${o.stopsOn}-${i}`));
}

/**
 * A list taken from the legs or the photos, once the author edits it: it
 * becomes their own map, its stops given ids of their own. The picked
 * pictures stay picked — a stop already holding one is not given it twice
 * (`driveRoute`).
 */
/** What a change to the source writes — fresh arrays, so any opener's options take them. */
export interface StopSourcePatch {
  stopsOn?: StopSource;
  stops?: MapStop[];
  picked?: HookPickedPicture[];
  includePieces?: boolean;
}

export function ownStops(from: StopSource, stops: readonly MapStop[]): StopSourcePatch {
  const stamp = Date.now().toString(36);
  const fresh = stops.map((stop, i) => (stop.id.startsWith(`${from}-`) ? { ...stop, id: `own-${stamp}-${i}` } : stop));
  return { stopsOn: 'custom', stops: fresh };
}
