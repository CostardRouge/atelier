/**
 * The ONE place a hook's context is built from the document.
 *
 * Every surface that paints a hook — the stage, the PNG deck, the rail's
 * thumbnails, both video exports — and the deck's own "does this slide move?"
 * question need the same `HookContext`. Building it in each of them is how a
 * thumbnail starts disagreeing with the export, which is the fault
 * `slide-render.ts` exists to stop for the rest of a slide.
 *
 * An opener may sit on ANY slide (`slide-capacities.ts`), and what it is told
 * about time is that slide's: how long it is on screen, what its badge's
 * numeral counts. Everything else — the calendar, the legs, the car, the day
 * told — is the trip's and the piece's, whichever slide asks.
 *
 * Pure: the pictures are decoded elsewhere and handed in.
 */

import type { BadgeContent, CounterMode } from '../day-badge';
import type { TripDoc, TripPost } from '../trip-types';
import { hookCalendar, hookStages } from './hook-calendar';
import type { HookContext, HookLayer, HookPicture } from './hook-variant';
import { resolveHook } from './registry';

/** What an opener is told about time on the slide it plays on. */
export interface HookTiming {
  /** The badge's life on that slide — what an exit animation lands on. */
  durationSeconds: number;
  /** How long the slide is on screen. */
  screenSeconds: number;
  /** What the slide's badge counts; absent where the slide draws none. */
  counterMode?: CounterMode;
}

/** The first slide's timing: the piece's own badge, as it always was. */
export function pieceHookTiming(post: TripPost): HookTiming {
  return {
    durationSeconds: post.badge.durationSeconds,
    screenSeconds: post.badge.hookSeconds,
    counterMode: post.badge.mode,
  };
}

/**
 * Another slide's timing. With no badge of its own, its opener lives for the
 * slide and is told no counter — so a sweep that steps the numeral has no
 * numeral to step, rather than stepping one the slide does not draw.
 */
export function slideHookTiming(slide: {
  seconds: number;
  badge: { durationSeconds: number; mode: CounterMode } | null;
}): HookTiming {
  return {
    durationSeconds: slide.badge?.durationSeconds ?? slide.seconds,
    screenSeconds: slide.seconds,
    counterMode: slide.badge?.mode,
  };
}

export function hookContextFor(
  trip: TripDoc,
  post: TripPost,
  aspect: number,
  content: BadgeContent | null,
  pictures?: ReadonlyMap<string, HookPicture>,
  timing: HookTiming = pieceHookTiming(post),
): HookContext {
  return {
    aspect,
    durationSeconds: timing.durationSeconds,
    screenSeconds: timing.screenSeconds,
    date: post.date,
    content,
    counterMode: timing.counterMode,
    calendar: hookCalendar(trip, post.id),
    stages: hookStages(trip),
    pictures,
    car: trip.car,
  };
}

/**
 * Whether an opener plays anything — what makes an `auto` slide leave as a
 * video even when nothing else on it moves. Measured by preparing it, never
 * guessed from its id: a scrub on the trip's first day has nowhere to sweep
 * from and plays nothing.
 */
export function openerMoves(
  trip: TripDoc,
  post: TripPost,
  layers: readonly HookLayer[] | null,
  timing: HookTiming,
): boolean {
  if (!layers?.length) return false;
  return resolveHook(layers, hookContextFor(trip, post, 1, null, undefined, timing)).seconds > 0;
}

/** Whether the piece's own opener — the first slide's — plays anything. */
export function hookMoves(trip: TripDoc, post: TripPost): boolean {
  return openerMoves(trip, post, post.badge.hook, pieceHookTiming(post));
}
