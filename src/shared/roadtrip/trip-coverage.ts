/**
 * What the trip's calendar looks like once its posts are laid over it — the
 * data behind the overview grid.
 *
 * The point of the grid is the HOLES: the maintainer is telling a trip a year
 * after it happened, from thousands of photos, and what he cannot hold in his
 * head is which days he has never told. So the unit here is the day, every day
 * of the trip is present whether or not anything was posted from it, and a
 * stretch of silence is a first-class result (`gaps`) rather than something the
 * caller has to re-derive by scanning.
 *
 * Pure and DOM-free.
 */

import {
  dayNumber,
  enumerateDays,
  isWithin,
  spanLength,
  type IsoDate,
} from './trip-days';
import type { TripDoc, TripPost, TripStage } from './trip-types';

/** One day of the trip, with everything told from it. */
export interface DayCell {
  date: IsoDate;
  /** 1-based day of the trip — the "27" of "jour 27/310". */
  dayNumber: number;
  posts: TripPost[];
  /** How many of those actually went out (the rest are still drafts). */
  published: number;
}

/** A run of consecutive days nothing was ever posted from. */
export interface Gap {
  start: IsoDate;
  end: IsoDate;
  length: number;
}

export interface TripCoverage {
  days: DayCell[];
  totalDays: number;
  /** Days with at least one post, draft or published. */
  toldDays: number;
  /** Days with at least one PUBLISHED post. */
  publishedDays: number;
  posts: number;
  publishedPosts: number;
  gaps: Gap[];
  /** The longest stretch of silence, or null when every day is told. */
  longestGap: Gap | null;
}

/**
 * The days a post occupies, clamped to the trip. A post covering days 27–29
 * marks all three: the question the grid answers is "has this day been told",
 * and a three-day post tells three days. Clamping matters because a post may
 * legitimately be dated outside the trip (a travel day, an arrival shot) and
 * an unclamped span would walk off the end of the grid.
 */
export function postDays(trip: TripDoc, post: TripPost): IsoDate[] {
  const end = post.endDate && post.endDate > post.date ? post.endDate : post.date;
  return enumerateDays(post.date, end).filter((d) =>
    isWithin(trip.startDate, trip.endDate, d),
  );
}

/**
 * Where a post sits in the trip: `from`/`to` are 1-based day numbers and
 * `total` the trip's length — everything a "Day 27 / 310" badge needs, with no
 * formatting decided here. Null when the trip's own span is unusable.
 */
export function postDayRange(
  trip: TripDoc,
  post: TripPost,
): { from: number; to: number; total: number } | null {
  const total = spanLength(trip.startDate, trip.endDate);
  const from = dayNumber(trip.startDate, post.date);
  if (total === null || from === null) return null;
  const rawTo =
    post.endDate && post.endDate > post.date
      ? dayNumber(trip.startDate, post.endDate)
      : from;
  return { from, to: rawTo ?? from, total };
}

/** Posts grouped by every day they occupy, trip days only. */
export function postsByDay(trip: TripDoc): Map<IsoDate, TripPost[]> {
  const map = new Map<IsoDate, TripPost[]>();
  for (const post of trip.posts) {
    for (const date of postDays(trip, post)) {
      const list = map.get(date);
      if (list) list.push(post);
      else map.set(date, [post]);
    }
  }
  return map;
}

/**
 * The whole calendar with its posts, its counts and its silences. Days are in
 * order and every day of the trip is present, so the caller can lay them into
 * a grid without filling anything in.
 */
export function tripCoverage(trip: TripDoc): TripCoverage {
  const byDay = postsByDay(trip);
  const days: DayCell[] = enumerateDays(trip.startDate, trip.endDate).map(
    (date, i) => {
      const posts = byDay.get(date) ?? [];
      return {
        date,
        dayNumber: i + 1,
        posts,
        published: posts.filter((p) => p.publishedAt !== null).length,
      };
    },
  );

  const gaps: Gap[] = [];
  let run: DayCell[] = [];
  const closeRun = () => {
    if (!run.length) return;
    gaps.push({
      start: run[0].date,
      end: run[run.length - 1].date,
      length: run.length,
    });
    run = [];
  };
  for (const day of days) {
    if (day.posts.length === 0) run.push(day);
    else closeRun();
  }
  closeRun();

  const longestGap = gaps.reduce<Gap | null>(
    (best, gap) => (best === null || gap.length > best.length ? gap : best),
    null,
  );

  return {
    days,
    totalDays: days.length,
    toldDays: days.filter((d) => d.posts.length > 0).length,
    publishedDays: days.filter((d) => d.published > 0).length,
    posts: trip.posts.length,
    publishedPosts: trip.posts.filter((p) => p.publishedAt !== null).length,
    gaps,
    longestGap,
  };
}

/**
 * The stage covering a date. Stages may legitimately overlap (a travel day
 * belongs to the place you left and the one you reached), and the LAST match
 * wins — stages are kept in the order the trip was lived, so the later one is
 * where you ended up that day, which is what a badge should name.
 */
export function stageAt(trip: TripDoc, date: IsoDate): TripStage | null {
  let found: TripStage | null = null;
  for (const stage of trip.stages) {
    if (isWithin(stage.startDate, stage.endDate, date)) found = stage;
  }
  return found;
}

/**
 * Where a date sits inside its stage — "Kalbarri · day 2/3". Null when the
 * date is outside the stage, so a caller never prints a day number for a place
 * the trip was not at.
 */
export function stageDayNumber(
  stage: TripStage,
  date: IsoDate,
): { day: number; total: number } | null {
  if (!isWithin(stage.startDate, stage.endDate, date)) return null;
  const day = dayNumber(stage.startDate, date);
  const total = spanLength(stage.startDate, stage.endDate);
  if (day === null || total === null) return null;
  return { day, total };
}
