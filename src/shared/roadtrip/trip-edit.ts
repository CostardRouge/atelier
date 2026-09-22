/**
 * Editing a trip's SPAN after it was created — the one thing the creation
 * modal asks for and nothing could change afterwards.
 *
 * It is load-bearing: the dates are what every badge counts from ("day 27 /
 * 310"), so a typo in either was a trip to recreate. The arithmetic that makes
 * the change safe is here rather than in the component — the SPAN is the
 * ruler's own frame (`stage-edit.ts`), so a leg can never sit outside it:
 * shrinking the trip trims the legs it still covers and removes the ones it no
 * longer reaches at all. Posts are NEVER touched — a post is the author's work
 * and its date is the key of the whole model; one left outside simply stops
 * being drawn (`postDays` already clamps), and the caller says so before
 * saving rather than deleting anything.
 *
 * The sheet used to edit the trip's ROUTE here too, writing its two ends back
 * into the first and last legs. That is gone (2026-09-22): a place is a leg's,
 * and the legs are edited where they are drawn.
 *
 * Pure and DOM-free.
 */

import type { IsoDate } from './trip-days';
import type { TripDoc, TripPost, TripStage } from './trip-types';

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

/** What the modal hands back when a trip's dates are edited. */
export interface TripDetailsEdit {
  startDate: IsoDate;
  endDate: IsoDate;
}

/**
 * The whole edit, applied: the new span, and the legs brought inside it.
 *
 * `updatedAt` is the caller's, as everywhere else in this tool.
 */
export function applyTripDetails(trip: TripDoc, edit: TripDetailsEdit): TripDoc {
  return {
    ...trip,
    startDate: edit.startDate,
    endDate: edit.endDate,
    stages: retimeStages(trip.stages, edit.startDate, edit.endDate),
  };
}
