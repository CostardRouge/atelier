/**
 * The ONE place a hook's context is built from the document.
 *
 * Every surface that paints a hook — the stage, the PNG deck, the rail's
 * thumbnails, both video exports — and the deck's own "does this slide move?"
 * question need the same `HookContext`. Building it in each of them is how a
 * thumbnail starts disagreeing with the export, which is the fault
 * `slide-render.ts` exists to stop for the rest of a slide.
 *
 * Pure: the pictures are decoded elsewhere and handed in.
 */

import type { BadgeContent } from '../day-badge';
import type { TripDoc, TripPost } from '../trip-types';
import { hookCalendar, hookStages } from './hook-calendar';
import type { HookContext, HookPicture } from './hook-variant';
import { resolveHook } from './registry';

export function hookContextFor(
  trip: TripDoc,
  post: TripPost,
  aspect: number,
  content: BadgeContent | null,
  pictures?: ReadonlyMap<string, HookPicture>,
): HookContext {
  return {
    aspect,
    durationSeconds: post.badge.durationSeconds,
    screenSeconds: post.badge.hookSeconds,
    date: post.date,
    content,
    counterMode: post.badge.mode,
    calendar: hookCalendar(trip, post.id),
    stages: hookStages(trip),
    pictures,
  };
}

/**
 * Whether the piece's opener plays anything — what makes an `auto` hook leave
 * as a video even when no badge piece is animated. Measured by preparing it,
 * never guessed from its id: a scrub on the trip's first day has nowhere to
 * sweep from and plays nothing.
 */
export function hookMoves(trip: TripDoc, post: TripPost): boolean {
  return resolveHook(post.badge.hook, hookContextFor(trip, post, 1, null)).seconds > 0;
}
