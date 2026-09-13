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
 * - `hookDayPosts` — for each wanted day, the ONE piece whose hook picture
 *   stands for it: the piece the variant named when it still tells that day,
 *   else the published one, else the first. A day told three times flashes
 *   once.
 */

import { tripCoverage } from '../trip-coverage';
import { stageLabel } from '../trip-places';
import type { TripDoc } from '../trip-types';
import type { HookDay, HookPictureWant, HookStage } from './hook-variant';

export function hookCalendar(trip: TripDoc, excludePostId: string | null): HookDay[] {
  const legStarts = new Set(trip.stages.map((stage) => stage.startDate));
  return tripCoverage(trip).days.map((cell) => {
    const others = cell.posts.filter((post) => post.id !== excludePostId);
    return {
      date: cell.date,
      dayNumber: cell.dayNumber,
      told: others.length > 0,
      legStart: legStarts.has(cell.date),
      pieces: others.map((post) => ({
        id: post.id,
        title: post.title.trim(),
        published: post.publishedAt !== null,
      })),
    };
  });
}

/** The piece whose hook picture stands for each wanted day, where one exists. */
export function hookDayPosts(
  trip: TripDoc,
  wants: readonly HookPictureWant[],
  excludePostId: string | null,
): Map<string, string> {
  const preferred = new Map<string, string | undefined>();
  for (const want of wants) preferred.set(want.date, want.postId);
  const out = new Map<string, string>();
  for (const cell of tripCoverage(trip).days) {
    if (!preferred.has(cell.date)) continue;
    const others = cell.posts.filter((post) => post.id !== excludePostId);
    const named = preferred.get(cell.date);
    const chosen =
      others.find((post) => post.id === named) ??
      others.find((post) => post.publishedAt !== null) ??
      others[0];
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
