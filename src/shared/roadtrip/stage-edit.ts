/**
 * The edits the stage ruler and the calendar's context menu make to a trip's
 * legs: dragging an edge, sliding a whole leg, starting or ending one on a
 * day pointed at. Each is a pure function of (trip, …) → new stages, so the
 * gestures in the components only translate pixels into days and hand over.
 *
 * Every edit keeps a stage INSIDE the trip: a drag past the trip's edge stops
 * at the edge rather than moving the trip, because the trip's dates are the
 * ruler's own frame and a leg cannot be somewhere the trip was not.
 *
 * Pure and DOM-free.
 */

import { stageAt } from './trip-coverage';
import { addDays, daysBetween, isWithin, type IsoDate } from './trip-days';
import { stageLabel } from './trip-places';
import { createTripStage, type TripDoc, type TripStage } from './trip-types';

type Span = Pick<TripDoc, 'startDate' | 'endDate'>;

function clampToTrip(trip: Span, date: IsoDate): IsoDate {
  if (date < trip.startDate) return trip.startDate;
  if (date > trip.endDate) return trip.endDate;
  return date;
}

/**
 * Move one edge of a stage to `date`. The other edge holds; dragging the
 * start past the end (or the end before the start) collapses the leg to that
 * one day rather than reversing it.
 */
export function resizeStage(
  trip: Span,
  stage: TripStage,
  edge: 'start' | 'end',
  date: IsoDate,
): TripStage {
  const d = clampToTrip(trip, date);
  if (edge === 'start') {
    return { ...stage, startDate: d, endDate: d > stage.endDate ? d : stage.endDate };
  }
  return { ...stage, endDate: d, startDate: d < stage.startDate ? d : stage.startDate };
}

/**
 * Slide a whole stage by `days`, keeping its length. The slide is reduced so
 * the leg stays inside the trip — a leg already against the trip's end does
 * not move at all.
 */
export function shiftStage(trip: Span, stage: TripStage, days: number): TripStage {
  const len = daysBetween(stage.startDate, stage.endDate);
  if (len === null || !Number.isFinite(days)) return stage;
  const room = {
    back: daysBetween(trip.startDate, stage.startDate) ?? 0,
    on: daysBetween(stage.endDate, trip.endDate) ?? 0,
  };
  const delta = Math.max(-room.back, Math.min(room.on, Math.trunc(days)));
  if (delta === 0) return stage;
  const startDate = addDays(stage.startDate, delta);
  const endDate = addDays(stage.endDate, delta);
  if (!startDate || !endDate) return stage;
  return { ...stage, startDate, endDate };
}

/**
 * Where a new stage goes in `stages` so the list stays in lived order: before
 * the first stage that starts after it, else last.
 */
export function insertStageInOrder(stages: readonly TripStage[], stage: TripStage): TripStage[] {
  const at = stages.findIndex((s) => s.startDate > stage.startDate);
  const next = stages.slice();
  next.splice(at < 0 ? next.length : at, 0, stage);
  return next;
}

export interface StageEditResult {
  stages: TripStage[];
  /** The leg the edit is about, for the editor to open. */
  selectedId: string;
}

/**
 * A new leg beginning on `date` — "from here, a new leg". It runs until the
 * day before the next leg begins, else to the trip's end, and a leg that was
 * covering this day is CUT to end the day before: pointing inside a leg and
 * starting another is how a leg is split, the way a cut on a video timeline
 * ends one clip where the next begins. A leg that itself begins on this very
 * day is left alone and the new one is a single day beside it, to be dragged
 * wider. Never shorter than the one day pointed at.
 */
export function startStageAt(
  trip: Pick<TripDoc, 'startDate' | 'endDate' | 'stages'>,
  date: IsoDate,
): StageEditResult {
  const start = clampToTrip(trip, date);
  let end = trip.endDate;
  for (const s of trip.stages) {
    if (s.startDate > start) {
      const before = addDays(s.startDate, -1);
      if (before && before < end) end = before;
    }
    if (s.startDate === start) end = start;
    // A split hands the cut leg's remaining days to the new one.
    if (s.startDate < start && s.endDate >= start && s.endDate < end) end = s.endDate;
  }
  if (end < start) end = start;
  const stage = createTripStage('', '', start, end);
  const cut = addDays(start, -1);
  const stages = trip.stages.map((s) =>
    cut && s.startDate < start && s.endDate >= start ? { ...s, endDate: cut } : s,
  );
  return { stages: insertStageInOrder(stages, stage), selectedId: stage.id };
}

/** A new leg covering exactly a gap the ruler found. */
export function stageOverGap(trip: Span, startDate: IsoDate, endDate: IsoDate): TripStage {
  return createTripStage('', '', clampToTrip(trip, startDate), clampToTrip(trip, endDate));
}

/** What the calendar's context menu offers for one day. */
export interface DayStageAction {
  id: 'start' | 'end' | 'extend';
  label: string;
  apply: (trip: TripDoc) => StageEditResult;
}

/**
 * How the menu names a leg: its label in quotes, else its number in the
 * list — the same "Stage 2" the editor's own header prints — never a
 * placeholder like "this stage" that could be any of them.
 */
function nameOf(trip: Pick<TripDoc, 'stages'>, stage: TripStage): string {
  const label = stageLabel(stage);
  return label ? `“${label}”` : `stage ${trip.stages.indexOf(stage) + 1}`;
}

/**
 * The actions that make sense on `date`, in the order they are offered:
 * start a leg here (always); end the leg covering this day here (when one
 * does and does not already); extend the last leg that ended before this
 * day to reach it (when the day is uncovered and such a leg exists).
 *
 * Each label names the REAL leg it would touch — "End “Perth → Kalbarri”
 * here" — never a placeholder, so the menu says what it will do before it
 * does it. Nothing here mutates: the result is applied by the caller.
 */
export function dayStageActions(trip: TripDoc, date: IsoDate): DayStageAction[] {
  if (!isWithin(trip.startDate, trip.endDate, date)) return [];
  const actions: DayStageAction[] = [
    {
      id: 'start',
      label: 'Start a stage here',
      apply: (t) => startStageAt(t, date),
    },
  ];
  const covering = stageAt(trip, date);
  if (covering) {
    if (covering.endDate !== date) {
      actions.push({
        id: 'end',
        label: `End ${nameOf(trip, covering)} here`,
        apply: (t) => ({
          stages: t.stages.map((s) =>
            s.id === covering.id ? resizeStage(t, s, 'end', date) : s,
          ),
          selectedId: covering.id,
        }),
      });
    }
    return actions;
  }
  let previous: TripStage | null = null;
  for (const s of trip.stages) {
    if (s.endDate < date && (!previous || s.endDate >= previous.endDate)) previous = s;
  }
  if (previous) {
    const target = previous;
    actions.push({
      id: 'extend',
      label: `Extend ${nameOf(trip, target)} to here`,
      apply: (t) => ({
        stages: t.stages.map((s) => (s.id === target.id ? resizeStage(t, s, 'end', date) : s)),
        selectedId: target.id,
      }),
    });
  }
  return actions;
}
