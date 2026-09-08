/**
 * What a trip's gallery card shows of itself.
 *
 * Two questions, both answered here so the card is pure presentation:
 *
 * 1. **Which pictures.** The pieces pinned to the cover lead; everything short
 *    is filled from the trip's BUSIEST DAYS — the days it was told the most,
 *    not the ones last touched. Recency churns (opening a piece would change
 *    the cover, and a test crop would become the trip); the busiest days are
 *    stable, and they are a real editorial signal: a day told three times is a
 *    day there was something to say about. Recency is not lost, it is
 *    subsumed — on a trip where every day holds one piece everything ties at
 *    one, the date tie-break takes over, and the cover is the latest days
 *    again. Nothing branches on that case.
 *
 * 2. **The rhythm**, for a trip with no picture to show: one bar per day, or
 *    per equal bucket of days once the trip is longer than the strip is wide.
 *    Derived from the coverage the overview already builds, so it is right on
 *    a trip created ten seconds ago and can never go stale.
 *
 * The whole resolution runs on EVERY render, which is what makes a pin a
 * preference rather than a dependency: a deleted piece, a re-exported picture
 * and a shrunk span all need zero repair — the chain simply lands one rung
 * further down. Pure and DOM-free; the thumbnails themselves are the caller's
 * business, handed in as `hasThumb`.
 */

import { daysBetween, type IsoDate } from './trip-days';
import type { DayCell, TripCoverage } from './trip-coverage';
import {
  COVER_TILES,
  type CoverLayout,
  type TripCover,
  type TripDoc,
  type TripPost,
} from './trip-types';

/** One picture of the cover, in draw order. */
export interface CoverTile {
  postId: string;
  date: IsoDate;
  /** 1-based day of the trip, or null for a piece the span no longer reaches. */
  dayNumber: number | null;
  /** Pinned by the author, rather than ranked. */
  pinned: boolean;
}

/** How many pictures `layout` asks for. */
export function coverTileCount(layout: CoverLayout): number {
  return COVER_TILES[layout] ?? 0;
}

/**
 * The trip's days that were told, best first: pieces on the day, then how many
 * of them went out, then the later date. Deterministic to the last key, so two
 * equally busy days never trade places between two renders.
 */
export function rankedCoverDays(coverage: TripCoverage): DayCell[] {
  return coverage.days
    .filter((day) => day.posts.length > 0)
    .slice()
    .sort(
      (a, b) =>
        b.posts.length - a.posts.length ||
        b.published - a.published ||
        (a.date < b.date ? 1 : a.date > b.date ? -1 : 0),
    );
}

/**
 * The one piece a day puts forward: what actually went out if anything did,
 * else the first with a picture. A day whose pieces have no thumbnail puts
 * nothing forward and is passed over — a cover cannot draw an absence.
 */
function pieceOf(
  day: DayCell,
  hasThumb: (postId: string) => boolean,
  taken: ReadonlySet<string>,
): TripPost | null {
  const drawable = day.posts.filter((post) => hasThumb(post.id) && !taken.has(post.id));
  return drawable.find((post) => post.publishedAt !== null) ?? drawable[0] ?? null;
}

/**
 * The pictures the cover draws, in order — pinned pieces first, then one piece
 * from each of the busiest days, never twice from the same day. Fewer than
 * asked for is normal and is the whole point: a mosaic of one is a cover.
 */
export function coverTiles(
  trip: TripDoc,
  coverage: TripCoverage,
  hasThumb: (postId: string) => boolean,
  limit: number = coverTileCount(trip.cover.layout),
): CoverTile[] {
  if (limit <= 0) return [];
  const byId = new Map(trip.posts.map((post) => [post.id, post]));
  const tiles: CoverTile[] = [];
  const usedDays = new Set<IsoDate>();
  const usedPosts = new Set<string>();

  const take = (post: TripPost, pinned: boolean) => {
    tiles.push({
      postId: post.id,
      date: post.date,
      dayNumber: dayNumberOf(trip, post.date),
      pinned,
    });
    usedPosts.add(post.id);
    usedDays.add(post.date);
  };

  for (const id of trip.cover.pinned) {
    if (tiles.length >= limit) break;
    const post = byId.get(id);
    // A pin naming no post, or a post whose picture is not baked here, is
    // skipped in silence: the sheet is where a dropped pin is worth a word.
    if (!post || usedPosts.has(id) || !hasThumb(id)) continue;
    take(post, true);
  }

  for (const day of rankedCoverDays(coverage)) {
    if (tiles.length >= limit) break;
    if (usedDays.has(day.date)) continue;
    const post = pieceOf(day, hasThumb, usedPosts);
    if (post) take(post, false);
  }

  return tiles;
}

/**
 * The pieces whose thumbnails must be in hand before a cover can be resolved:
 * the pins, plus every piece of the busiest days down to `depth`. Deeper than
 * the layout asks for, because a day whose pieces have no picture is passed
 * over and the next day has to be ready — and wider than one piece per day,
 * because which piece a day puts forward depends on which pictures exist.
 * Bounded on purpose: a trip is 250 pieces and the store reads them one by one.
 */
export function coverCandidateIds(
  trip: TripDoc,
  coverage: TripCoverage,
  depth = 6,
): string[] {
  const ids = new Set<string>(trip.cover.pinned);
  for (const day of rankedCoverDays(coverage).slice(0, depth)) {
    for (const post of day.posts) ids.add(post.id);
  }
  return [...ids];
}

/**
 * The 1-based day of the trip a date falls on, or null when the span does not
 * reach it — which happens to a pinned piece after the dates are edited, since
 * a post is never touched by that edit and simply stops being drawn.
 */
export function dayNumberOf(trip: TripDoc, date: IsoDate): number | null {
  const from = daysBetween(trip.startDate, date);
  if (from === null || from < 0) return null;
  const total = daysBetween(trip.startDate, trip.endDate);
  if (total === null || from > total) return null;
  return from + 1;
}

/** Pinned ids that name no piece of this trip any more. */
export function droppedPins(trip: TripDoc): string[] {
  const ids = new Set(trip.posts.map((post) => post.id));
  return trip.cover.pinned.filter((id) => !ids.has(id));
}

/**
 * `cover` with every pin that names no piece of `trip` removed. Called when an
 * edit is COMMITTED, never while it is being made: the panel says a pin was
 * dropped, and a note that cleared itself the moment you touched anything else
 * would never be read.
 */
export function prunePins(trip: TripDoc, cover: TripCover): TripCover {
  const gone = new Set(droppedPins({ ...trip, cover }));
  if (gone.size === 0) return cover;
  return { ...cover, pinned: cover.pinned.filter((id) => !gone.has(id)) };
}

/** `trip.cover.pinned` with `postId` added or removed, capped at `max`. */
export function togglePin(pinned: readonly string[], postId: string, max = 3): string[] {
  if (pinned.includes(postId)) return pinned.filter((id) => id !== postId);
  return [...pinned, postId].slice(-max);
}

// --- the rhythm -------------------------------------------------------------

/** One bar of the rhythm strip: a stretch of days and what came out of it. */
export interface RhythmBucket {
  from: IsoDate;
  to: IsoDate;
  /** Days in the bucket — 1 on a trip short enough to draw day by day. */
  days: number;
  /** How many of them were told at all. */
  told: number;
  /** Pieces across the bucket, drafts included. */
  posts: number;
}

/**
 * The trip's days folded onto at most `max` bars. Under that many days the
 * ruler is the trip itself, one bar per day; over it, equal buckets — never a
 * calendar week, because a bucket that does not divide the span leaves a
 * ragged last bar that reads as a hole rather than as arithmetic.
 */
export function rhythmBuckets(coverage: TripCoverage, max = 49): RhythmBucket[] {
  const days = coverage.days;
  if (!days.length || max <= 0) return [];
  const size = Math.max(1, Math.ceil(days.length / max));
  const out: RhythmBucket[] = [];
  for (let i = 0; i < days.length; i += size) {
    const slice = days.slice(i, i + size);
    out.push({
      from: slice[0].date,
      to: slice[slice.length - 1].date,
      days: slice.length,
      told: slice.filter((day) => day.posts.length > 0).length,
      posts: slice.reduce((n, day) => n + day.posts.length, 0),
    });
  }
  return out;
}

/**
 * The bucket's rung on the heatmap's own five-step ramp, so the card and the
 * overview's grid say the same thing about the same day. Nothing told is rung
 * zero — bare paper, and a bar still drawn, because a day that produced
 * nothing is exactly what the strip exists to show.
 */
export function rhythmLevel(bucket: RhythmBucket): number {
  if (bucket.told === 0) return 0;
  return 1 + Math.min(3, Math.floor((bucket.told / bucket.days) * 4));
}
