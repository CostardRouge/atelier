/**
 * Editing a trip's SPAN and its ROUTE after it was created — the two things
 * the creation modal asks for and nothing could change afterwards.
 *
 * Both are load-bearing: the dates are what every badge counts from ("day 27 /
 * 310") and the route's two ends are what a stage-less trip's caption says, so
 * a typo in either was a trip to recreate. They are edited together because
 * they were entered together, in the same modal, and the arithmetic that makes
 * a change safe is here rather than in the component:
 *
 * - the SPAN is the ruler's own frame (`stage-edit.ts`), so a leg can never sit
 *   outside it: shrinking the trip trims the legs it still covers and removes
 *   the ones it no longer reaches at all. Posts are NEVER touched — a post is
 *   the author's work and its date is the key of the whole model; one left
 *   outside simply stops being drawn (`postDays` already clamps), and the
 *   caller says so before saving rather than deleting anything.
 * - the ROUTE is `places[0]` of the first stage and the last place of the last
 *   (`tripRouteEnds`), never a stored pair — so editing it WRITES BACK into
 *   those stages instead of adding a third copy of where the trip went.
 *
 * Pure and DOM-free.
 */

import type { IsoDate } from './trip-days';
import { tripRouteEnds, tripRouteLabel } from './trip-places';
import {
  createTripPlace,
  createTripStage,
  type TripDoc,
  type TripPlace,
  type TripPost,
  type TripStage,
} from './trip-types';

/** The days a post covers by its own dates, unclamped. */
function postSpan(post: TripPost): { start: IsoDate; end: IsoDate } {
  const end = post.endDate && post.endDate > post.date ? post.endDate : post.date;
  return { start: post.date, end };
}

/**
 * What moving the trip's dates to `startDate` → `endDate` would do to what is
 * already in it. Shown before saving: a trip told over a year must never lose
 * a leg or hide a piece without the author having read the sentence first.
 */
export interface SpanImpact {
  /** Legs the new span still covers, but only partly — they will be trimmed. */
  trimmedStages: number;
  /** Legs the new span does not reach at all — they will be removed. */
  droppedStages: number;
  /** Pieces that would sit outside the trip. They are KEPT, just not drawn. */
  strandedPosts: number;
}

export function spanImpact(
  trip: Pick<TripDoc, 'stages' | 'posts'>,
  startDate: IsoDate,
  endDate: IsoDate,
): SpanImpact {
  let trimmedStages = 0;
  let droppedStages = 0;
  for (const stage of trip.stages) {
    if (stage.endDate < startDate || stage.startDate > endDate) droppedStages += 1;
    else if (stage.startDate < startDate || stage.endDate > endDate) trimmedStages += 1;
  }
  const strandedPosts = trip.posts.filter((post) => {
    const span = postSpan(post);
    return span.end < startDate || span.start > endDate;
  }).length;
  return { trimmedStages, droppedStages, strandedPosts };
}

/** True when the impact is worth a sentence — nothing to say is the normal case. */
export function hasImpact(impact: SpanImpact): boolean {
  return (
    impact.trimmedStages > 0 || impact.droppedStages > 0 || impact.strandedPosts > 0
  );
}

/**
 * The legs, brought inside a new span: trimmed where they overhang, dropped
 * where they fall outside entirely. Order is kept — it is the order the trip
 * was lived, which `stageAt` and the route both read.
 */
export function retimeStages(
  stages: readonly TripStage[],
  startDate: IsoDate,
  endDate: IsoDate,
): TripStage[] {
  const out: TripStage[] = [];
  for (const stage of stages) {
    if (stage.endDate < startDate || stage.startDate > endDate) continue;
    const start = stage.startDate < startDate ? startDate : stage.startDate;
    const end = stage.endDate > endDate ? endDate : stage.endDate;
    out.push(
      start === stage.startDate && end === stage.endDate
        ? stage
        : { ...stage, startDate: start, endDate: end },
    );
  }
  return out;
}

function replacePlace(
  stages: readonly TripStage[],
  id: string,
  value: TripPlace,
): TripStage[] {
  return stages.map((stage) =>
    stage.places.some((place) => place.id === id)
      ? {
          ...stage,
          places: stage.places.map((place) =>
            place.id === id
              ? { ...place, name: value.name.trim(), region: value.region.trim(), coords: value.coords }
              : place,
          ),
        }
      : stage,
  );
}

function removePlace(stages: readonly TripStage[], id: string): TripStage[] {
  return stages.map((stage) =>
    stage.places.some((place) => place.id === id)
      ? { ...stage, places: stage.places.filter((place) => place.id !== id) }
      : stage,
  );
}

/**
 * Add a place at one end of the trip. A FRESH id every time — the two drafts
 * the modal edits can be the same stored place (a trip that names one place is
 * its own start and end), and reusing its id would put it in twice.
 */
function addPlace(
  stages: readonly TripStage[],
  where: 'head' | 'tail',
  value: TripPlace,
): TripStage[] {
  const index = where === 'head' ? 0 : stages.length - 1;
  const fresh = createTripPlace(value.name, value.region, value.coords);
  return stages.map((stage, i) =>
    i === index
      ? {
          ...stage,
          places: where === 'head' ? [fresh, ...stage.places] : [...stage.places, fresh],
        }
      : stage,
  );
}

/**
 * Write the trip's two ends back into its legs.
 *
 * With no leg at all the pair SEEDS one covering the whole trip, exactly as
 * `createTripDoc` does — that is the case the creation modal's From/To already
 * handled, and it must keep behaving the same when the fields are filled in
 * later. With legs, the end being edited is the place `tripRouteEnds` names,
 * so what the badge reads as the trip's route is what the field changes:
 * emptying it removes that place (the leg keeps its dates and derives its
 * label from what is left), and naming an end the trip did not have adds one.
 */
export function setTripRoute(
  trip: Pick<TripDoc, 'stages' | 'startDate' | 'endDate'>,
  from: TripPlace,
  to: TripPlace,
): TripStage[] {
  const fromNamed = from.name.trim().length > 0;
  const toNamed = to.name.trim().length > 0;

  if (trip.stages.length === 0) {
    const places = [
      ...(fromNamed ? [createTripPlace(from.name, from.region, from.coords)] : []),
      ...(toNamed ? [createTripPlace(to.name, to.region, to.coords)] : []),
    ];
    return places.length ? [createTripStage('', '', trip.startDate, trip.endDate, places)] : [];
  }

  const ends = tripRouteEnds(trip);
  // A trip naming ONE place is its own start and end. Writing "to" onto it
  // would rename the start; the second end is a place the trip has yet to
  // have, so it is added at the tail instead.
  const toTarget = ends.to && ends.to.id !== ends.from?.id ? ends.to : null;

  let stages: readonly TripStage[] = trip.stages;
  if (ends.from) {
    stages = fromNamed ? replacePlace(stages, ends.from.id, from) : removePlace(stages, ends.from.id);
  } else if (fromNamed) {
    stages = addPlace(stages, 'head', from);
  }
  if (toTarget) {
    stages = toNamed ? replacePlace(stages, toTarget.id, to) : removePlace(stages, toTarget.id);
  } else if (toNamed) {
    stages = addPlace(stages, 'tail', to);
  }
  return [...stages];
}

/** What the modal hands back when a trip's dates and route are edited. */
export interface TripDetailsEdit {
  startDate: IsoDate;
  endDate: IsoDate;
  /** Where the trip set out from — an empty name removes that end. */
  from: TripPlace;
  /** Where it ended. */
  to: TripPlace;
}

/**
 * The whole edit, applied: the route written back, then the legs brought
 * inside the new span. `destination` — the prose subtitle, composed from the
 * two ends at creation — follows the route only when the route actually
 * changed, so a trip whose dates were fixed keeps whatever line it was given
 * (a timeline import writes its own, and it is not the author's to lose).
 *
 * `updatedAt` is the caller's, as everywhere else in this tool.
 */
export function applyTripDetails(trip: TripDoc, edit: TripDetailsEdit): TripDoc {
  const spanned = { ...trip, startDate: edit.startDate, endDate: edit.endDate };
  const routed = setTripRoute(spanned, edit.from, edit.to);
  const stages = retimeStages(routed, edit.startDate, edit.endDate);
  const before = tripRouteLabel(trip);
  const after = tripRouteLabel({ stages });
  return {
    ...spanned,
    stages,
    destination: after === before ? trip.destination : after,
  };
}
