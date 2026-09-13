/**
 * The trip, as a hook variant is allowed to read it — built by the SHELL, never
 * by a variant (a variant never reads the store: `hook-variant.ts`).
 *
 * Two readings of the document, both pure:
 *
 * - `hookCalendar` — every day of the trip, whether ANOTHER piece tells it and
 *   whether a leg starts on it. The piece being composed never counts as
 *   telling its own day: a sweep that stopped on the hero's own day as a
 *   "told" day would flash the picture already on the frame.
 * - `hookDayPosts` — for each told day, the ONE piece whose hook picture stands
 *   for it: the published one when there is one, else the first. A day told
 *   three times flashes once.
 */

import { tripCoverage } from '../trip-coverage';
import { stageLabel } from '../trip-places';
import type { TripDoc } from '../trip-types';
import type { HookDay, HookStage } from './hook-variant';

export function hookCalendar(trip: TripDoc, excludePostId: string | null): HookDay[] {
  const legStarts = new Set(trip.stages.map((stage) => stage.startDate));
  return tripCoverage(trip).days.map((cell) => ({
    date: cell.date,
    dayNumber: cell.dayNumber,
    told: cell.posts.some((post) => post.id !== excludePostId),
    legStart: legStarts.has(cell.date),
  }));
}

/** The piece whose hook picture stands for each of `dates`, where one exists. */
export function hookDayPosts(
  trip: TripDoc,
  dates: readonly string[],
  excludePostId: string | null,
): Map<string, string> {
  const wanted = new Set(dates);
  const out = new Map<string, string>();
  for (const cell of tripCoverage(trip).days) {
    if (!wanted.has(cell.date)) continue;
    const others = cell.posts.filter((post) => post.id !== excludePostId);
    const chosen = others.find((post) => post.publishedAt !== null) ?? others[0];
    if (chosen) out.set(cell.date, chosen.id);
  }
  return out;
}

/** The legs, with only the places a drawing can use — those with coordinates. */
export function hookStages(trip: TripDoc): HookStage[] {
  return trip.stages.map((stage) => ({
    startDate: stage.startDate,
    endDate: stage.endDate,
    label: stageLabel(stage),
    places: stage.places.flatMap((place) =>
      place.coords &&
      Number.isFinite(place.coords.lat) &&
      Number.isFinite(place.coords.lon)
        ? [{ name: place.name, lat: place.coords.lat, lon: place.coords.lon }]
        : [],
    ),
  }));
}
