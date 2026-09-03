/**
 * Where a stage began, where it ended, and what to call it — all DERIVED from
 * its ordered list of places, never stored beside it.
 *
 * That is the same discipline the rest of the model follows: a trip's days are
 * derived from its two dates rather than kept as 310 rows, because a second
 * copy of a fact is a second thing to migrate and a second thing to get wrong.
 * A stage's start and end are `places[0]` and the last one; nothing else can
 * disagree with them.
 *
 * The other rule at work here is "empty means computed, never blank" — the one
 * `PostBadge.textOverrides` already follows. A stage whose `name` is cleared
 * falls back to the derived label instead of rendering nothing, so naming a
 * stage by hand is never a one-way door.
 *
 * Pure and DOM-free.
 */

import type { TripDoc, TripPlace, TripStage } from './trip-types';

/**
 * What joins two ends of a leg. A geometric arrow, not an emoji: this string
 * is drawn on a CANVAS through the overlay engine, where a font stack we do
 * not control decides what exists — and "📍" was measured drawing *nothing at
 * all* in a Chromium with no colour-emoji font. U+2192 is monochrome, present
 * everywhere, and takes the badge's own ink and glow.
 */
export const PLACE_ARROW = '→';

function named(place: TripPlace): string {
  return place.name.trim();
}

/** The places worth showing — one with no name is a row someone started. */
function namedPlaces(stage: TripStage): TripPlace[] {
  return (stage.places ?? []).filter((place) => named(place).length > 0);
}

/** Where the stage began: the first place it names, or null when it names none. */
export function stageStart(stage: TripStage): TripPlace | null {
  return namedPlaces(stage)[0] ?? null;
}

/**
 * Where the stage ended. With a single place this is the same one as
 * `stageStart`, which is the truth: you did not go anywhere.
 */
export function stageEnd(stage: TripStage): TripPlace | null {
  const places = namedPlaces(stage);
  return places[places.length - 1] ?? null;
}

/**
 * What a badge calls this stage. The author's own `name` always wins; an empty
 * one derives "Perth → Cairns" from the ends, or the single place's name, or
 * an empty string when the stage names nothing at all — in which case the
 * caller falls back rather than inventing a place (`day-badge.ts`).
 */
export function stageLabel(stage: TripStage): string {
  const own = stage.name.trim();
  if (own) return own;
  const from = stageStart(stage);
  const to = stageEnd(stage);
  if (!from) return '';
  if (!to || to.id === from.id) return named(from);
  return `${named(from)} ${PLACE_ARROW} ${named(to)}`;
}

/**
 * The stage's region. The author's own wins; otherwise the region its places
 * AGREE on — one place in Western Australia and one in Queensland have no
 * common region, and printing either would be a quiet lie about the other.
 */
export function stageRegionLabel(stage: TripStage): string {
  const own = stage.region.trim();
  if (own) return own;
  const regions = namedPlaces(stage)
    .map((place) => place.region.trim())
    .filter((region) => region.length > 0);
  if (regions.length === 0) return '';
  return regions.every((region) => region === regions[0]) ? regions[0] : '';
}

/** A place's region, falling back to its stage's — empty means "the stage's". */
export function placeRegionLabel(place: TripPlace, stage: TripStage): string {
  return place.region.trim() || stageRegionLabel(stage);
}

/**
 * The trip's route: the first place of its first stage to the last place of
 * its last stage. Stages are kept in the order the trip was lived, so this is
 * simply where it set out from and where it ended.
 */
export function tripRouteLabel(trip: TripDoc): string {
  const stages = trip.stages ?? [];
  let from: TripPlace | null = null;
  let to: TripPlace | null = null;
  for (const stage of stages) {
    from = from ?? stageStart(stage);
    to = stageEnd(stage) ?? to;
  }
  if (!from) return '';
  if (!to || to.id === from.id) return named(from);
  return `${named(from)} ${PLACE_ARROW} ${named(to)}`;
}

/**
 * Coordinates as a human reads them back. Six decimals is what the EXIF reader
 * writes (`exif-cue.ts`) — roughly 10 cm, far past what a phone or a drone
 * actually knows, but it round-trips what we were given without rewriting it.
 */
export function formatCoords(coords: { lat: number; lon: number } | null): string {
  if (!coords) return '';
  return `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`;
}
