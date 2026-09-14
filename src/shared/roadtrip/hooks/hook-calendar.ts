/**
 * The trip, as a hook variant is allowed to read it — built by the SHELL, never
 * by a variant (a variant never reads the store: `hook-variant.ts`).
 *
 * Pure readings of the document:
 *
 * - `hookCalendar` — every day of the trip, whether ANOTHER piece tells it,
 *   whether a leg starts on it, and the pieces that tell it with the SOURCE
 *   picture each is composed over. The piece being composed never counts as
 *   telling its own day: a sweep that stopped on the hero's own day as a
 *   "told" day would flash the picture already on the frame.
 * - `standingPiece` — the ONE piece whose picture stands for a day told
 *   several times: the published one, else the first. A day told three times
 *   flashes once.
 * - `hookStages` — the legs, with the places a drawing can use.
 */

import { tripCoverage } from '../trip-coverage';
import { stageLabel } from '../trip-places';
import type { TripDoc } from '../trip-types';
import type { HookDay, HookDayPiece, HookStage } from './hook-variant';

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
        media: post.media ?? null,
        videoSeconds: Number.isFinite(post.badge.videoTimeSeconds) ? post.badge.videoTimeSeconds : 0,
      })),
    };
  });
}

/**
 * The piece whose picture stands for `day`: the published one with a picture,
 * else the first with a picture — and when none has one, the published piece
 * or the first (which then has nothing to show). A draft's picture never
 * hides a published one's.
 */
export function standingPiece(day: HookDay): HookDayPiece | undefined {
  const pick = (pieces: readonly HookDayPiece[]) =>
    pieces.find((piece) => piece.published) ?? pieces[0];
  return pick(day.pieces.filter((piece) => piece.media !== null)) ?? pick(day.pieces);
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
