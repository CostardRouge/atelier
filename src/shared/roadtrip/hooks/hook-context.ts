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
 * numeral counts. Everything else — the calendar, the legs, the vehicle, the day
 * told — is the trip's and the piece's, whichever slide asks.
 *
 * Pure: the pictures are decoded elsewhere and handed in.
 */

import type { BadgeContent, CounterMode } from '../day-badge';
import type { TripDoc, TripPost } from '../trip-types';
import { hookCalendar, hookStages } from './hook-calendar';
import { townsIfLoaded } from '../load-gazetteer';
import type { HookContext, HookLayer, HookPicture } from './hook-variant';
import { resolveHook } from './registry';
import { resolveRef, vehicleRefForDay } from '../vehicle-fleet';
import { landIfLoaded } from '../../map/load-terrain';
import { tripRoadLine } from '../road-track';

/** What an opener is told about time on the slide it plays on. */
export interface HookTiming {
  /** The badge's life on that slide — what an exit animation lands on. */
  durationSeconds: number;
  /** How long the slide is on screen, as last set. */
  screenSeconds: number;
  /**
   * The slide FOLLOWS its opener (`slide-timing.ts`): its length is the
   * opener's plus a hold, so the opener is told no screen time — nothing
   * fits into it, nothing is cut by it. Absent or false: a set length.
   */
  auto?: boolean;
  /** What the slide's badge counts; absent where the slide draws none. */
  counterMode?: CounterMode;
}

/** The first slide's timing: the piece's own badge, as it always was. */
export function pieceHookTiming(post: TripPost): HookTiming {
  return {
    durationSeconds: post.badge.durationSeconds,
    screenSeconds: post.badge.hookSeconds,
    auto: post.badge.hookAuto === true,
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
  auto?: boolean;
  badge: { durationSeconds: number; mode: CounterMode } | null;
}): HookTiming {
  return {
    durationSeconds: slide.badge?.durationSeconds ?? slide.seconds,
    screenSeconds: slide.seconds,
    auto: slide.auto === true,
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
  const dayRef = vehicleRefForDay(trip.vehicles ?? [], trip.stages ?? [], post.date);
  return {
    aspect,
    durationSeconds: timing.durationSeconds,
    // An Auto slide follows its opener: the opener is told no screen time, so
    // it never fits into one nor warns of being cut by one.
    screenSeconds: timing.auto ? undefined : timing.screenSeconds,
    date: post.date,
    content,
    counterMode: timing.counterMode,
    calendar: hookCalendar(trip, post.id),
    stages: hookStages(trip),
    pictures,
    // The vehicle of the piece's own day — its stage's, else the main one — as
    // it was that day: a piece dated before the Prado's repaint shows it green.
    vehicle: resolveRef(dayRef, trip.vehicles ?? [], post.date),
    vehicleRef: dayRef,
    fleet: trip.vehicles,
    crossings: trip.crossings,
    // Read once per stored road (`tripRoadLine` keeps it), so every surface
    // drives the same line.
    road: tripRoadLine(trip.road ?? null),
    // Read, never fetched here, like the towns: the editor asks for the
    // coastline when a piece drives under the water rule.
    land: landIfLoaded(),
    writing: { placeStyle: trip.placeStyle, stateCodes: trip.stateCodes },
    badgeWords: trip.badgeWords,
    // Read, never fetched here: the editor asks for the index when a piece
    // groups by town, and every surface then names the same groups.
    towns: townsIfLoaded(),
    theme: trip.theme,
    tripName: trip.name,
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
