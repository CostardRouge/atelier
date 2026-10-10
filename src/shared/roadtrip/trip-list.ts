import type { DayCell } from './trip-coverage';
import { enumerateDays, isWithin, type IsoDate } from './trip-days';
import type { TripDoc, TripPost, TripStage } from './trip-types';

/**
 * The overview's LIST (2026-10-09, his ask beside Calendar and Map): the trip
 * read top to bottom as its stages in lived order, each with its days. A day
 * something was told from is a row of its own; a run of silent days is ONE
 * row («4 days silent»), because a year of empty rows is a list nobody reads
 * — and the silence is still said, never hidden.
 *
 * Pure and DOM-free: the component only draws these rows.
 */

/** A day with at least one piece. */
export interface ListDay {
  kind: 'day';
  date: IsoDate;
  /** 1-based day of the trip. */
  dayNumber: number;
  posts: TripPost[];
  published: number;
}

/** Consecutive days nothing was told from, inside one group. */
export interface ListSilence {
  kind: 'silence';
  from: IsoDate;
  to: IsoDate;
  /** How many days, ≥ 1. */
  count: number;
  /** The trip's day number of `from`. */
  dayNumber: number;
}

export type ListRow = ListDay | ListSilence;

/** A stage's run of consecutive days — or days no stage covers (`stage` null). */
export interface ListGroup {
  /** The stage's index in `trip.stages` (its tint), null for days in no stage. */
  stageIndex: number | null;
  stage: TripStage | null;
  from: IsoDate;
  to: IsoDate;
  /** Days in the group. */
  days: number;
  /** Days of the group something was told from. */
  told: number;
  rows: ListRow[];
}

/**
 * Each day's stage index, the LAST covering stage winning — the rule the
 * calendar's tint and `stageAt` already follow, so a travel day sits in the
 * stage it ended in on every surface.
 */
function stageIndexByDay(trip: Pick<TripDoc, 'stages' | 'startDate' | 'endDate'>): Map<IsoDate, number> {
  const out = new Map<IsoDate, number>();
  trip.stages.forEach((stage, index) => {
    for (const day of enumerateDays(stage.startDate, stage.endDate)) {
      if (isWithin(trip.startDate, trip.endDate, day)) out.set(day, index);
    }
  });
  return out;
}

/**
 * The trip's days as groups of rows, in date order. A group breaks wherever
 * the day's stage changes — so a stage interrupted by another (an excursion
 * in the middle of a stay) appears twice, as it was lived.
 */
export function tripList(trip: Pick<TripDoc, 'stages' | 'startDate' | 'endDate'>, days: readonly DayCell[]): ListGroup[] {
  const byDay = stageIndexByDay(trip);
  const groups: ListGroup[] = [];
  let group: ListGroup | null = null;
  let silence: ListSilence | null = null;

  for (const cell of days) {
    const index = byDay.get(cell.date) ?? null;
    if (!group || group.stageIndex !== index) {
      silence = null;
      group = {
        stageIndex: index,
        stage: index === null ? null : trip.stages[index],
        from: cell.date,
        to: cell.date,
        days: 0,
        told: 0,
        rows: [],
      };
      groups.push(group);
    }
    group.to = cell.date;
    group.days += 1;
    if (cell.posts.length) {
      silence = null;
      group.told += 1;
      group.rows.push({ kind: 'day', date: cell.date, dayNumber: cell.dayNumber, posts: cell.posts, published: cell.published });
    } else if (silence) {
      silence.to = cell.date;
      silence.count += 1;
    } else {
      silence = { kind: 'silence', from: cell.date, to: cell.date, count: 1, dayNumber: cell.dayNumber };
      group.rows.push(silence);
    }
  }
  return groups;
}

/** The group holding a date, for scrolling the list to the open day. */
export function groupOf(groups: readonly ListGroup[], date: IsoDate): number {
  return groups.findIndex((g) => g.from <= date && date <= g.to);
}
