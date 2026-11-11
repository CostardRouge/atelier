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
import type { SlideLength } from '../slide-length';
import { hookCalendar, hookStages } from './hook-calendar';
import { townsIfLoaded } from '../load-gazetteer';
import type { HookContext, HookLayer, HookPicture, ResolvedHook } from './hook-variant';
import { resolveHook } from './registry';
import { resolveRef, vehicleRefForDay } from '../vehicle-fleet';
import { landIfLoaded } from '../../map/load-terrain';
import { tripRoadLine } from '../road-track';
import { leadSlideOf } from '../piece-slides';

/** What an opener is told about time on the slide it plays on. */
export interface HookTiming {
  /** The badge's life on that slide — what an exit animation lands on. */
  durationSeconds: number;
  /** The slide's own stored seconds — a fixed length, or what a slide with no opener lasts. */
  screenSeconds: number;
  /**
   * Who decides the slide's length (`slide-length.ts`) — handed to
   * `resolveHook`, which runs the opener at the pace it resolves to. Absent:
   * the opener plays at its own pace and the slide follows it.
   */
  length?: SlideLength;
  /** What the slide's badge counts; absent where the slide draws none. */
  counterMode?: CounterMode;
}

/**
 * A slide's timing for its opener. The slide that carries the piece's badge
 * is told the piece's counter and the badge's own life; another is told its
 * chapter mark's, or — with no badge at all — lives for the slide and is told
 * no counter, so a sweep that steps the numeral has no numeral to step rather
 * than stepping one the slide does not draw.
 */
export function slideHookTiming(
  post: Pick<TripPost, 'badge'>,
  slide: {
    seconds: number;
    length: SlideLength;
    badge: { durationSeconds: number; mode: CounterMode } | null;
    pieceBadge?: boolean;
  },
): HookTiming {
  if (slide.pieceBadge) {
    return {
      durationSeconds: post.badge.durationSeconds,
      screenSeconds: slide.seconds,
      length: slide.length,
      counterMode: post.badge.mode,
    };
  }
  return {
    durationSeconds: slide.badge?.durationSeconds ?? slide.seconds,
    screenSeconds: slide.seconds,
    length: slide.length,
    counterMode: slide.badge?.mode,
  };
}

export function hookContextFor(
  trip: TripDoc,
  post: TripPost,
  aspect: number,
  content: BadgeContent | null,
  pictures?: ReadonlyMap<string, HookPicture>,
  timing: HookTiming = leadTiming(post),
): HookContext {
  const dayRef = vehicleRefForDay(trip.vehicles ?? [], trip.stages ?? [], post.date);
  return {
    aspect,
    durationSeconds: timing.durationSeconds,
    // Read by `resolveHook` alone, which runs the opener at the slide's pace.
    ...(timing.length ? { slideLength: { length: timing.length, seconds: timing.screenSeconds } } : {}),
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
 * A CACHE of resolved openers, OWNED by one surface (2026-11-10, `performance.md` rule 5). An edit of one slide
 * prepared every opener of the piece again — each Virée planning its whole road, its vehicles, its crossings —
 * in the deck's lengths, the rail's thumbnails and the stage alike. A resolution is kept per slide's layers
 * (the same array while that slide is untouched) and given back while everything an opener reads is the same:
 * the slide's timing, the aspect, the badge's content, the pictures, and the trip's and the piece's parts.
 *
 * A resolution carries mutable scratch (Virée's road, its caches), so a cache is never shared between two
 * surfaces that paint: each makes its own (`createHookCache()`); the deck's lengths, which never paint, use
 * `resolvedForTiming`.
 */
export interface HookCache {
  resolve(
    trip: TripDoc,
    post: TripPost,
    layers: readonly HookLayer[],
    timing: HookTiming,
    view?: { aspect?: number; content?: BadgeContent | null; pictures?: ReadonlyMap<string, HookPicture> },
  ): ResolvedHook;
}

const KEPT_PER_LAYERS = 4;

export function createHookCache(): HookCache {
  const kept = new WeakMap<readonly HookLayer[], { deps: readonly unknown[]; hook: ResolvedHook }[]>();
  return {
    resolve(trip, post, layers, timing, view = {}) {
      const aspect = view.aspect ?? 1;
      const content = view.content ?? null;
      const deps: unknown[] = [
        aspect,
        // The badge's words are rebuilt per call: compared by what they say.
        content ? JSON.stringify(content) : null,
        view.pictures,
        timing.durationSeconds,
        timing.screenSeconds,
        timing.length,
        timing.counterMode,
        post.date,
        hookCalendar(trip, post.id),
        trip.stages,
        trip.vehicles,
        trip.crossings,
        trip.road,
        trip.placeStyle,
        trip.stateCodes,
        trip.badgeWords,
        trip.theme,
        trip.name,
        townsIfLoaded(),
        landIfLoaded(),
      ];
      const list = kept.get(layers) ?? [];
      const hit = list.find((e) => e.deps.length === deps.length && e.deps.every((d, i) => Object.is(d, deps[i])));
      if (hit) return hit.hook;
      const hook = resolveHook(layers, hookContextFor(trip, post, aspect, content, view.pictures, timing));
      list.push({ deps, hook });
      if (list.length > KEPT_PER_LAYERS) list.shift();
      kept.set(layers, list);
      return hook;
    },
  };
}

/** The deck's lengths and `openerMoves`: surfaces that read an opener's TIMING and never paint it. */
const forTiming = createHookCache();

/** A slide's opener resolved for its timing alone (aspect 1, no content, no pictures), cached. */
export function resolvedForTiming(trip: TripDoc, post: TripPost, layers: readonly HookLayer[], timing: HookTiming): ResolvedHook {
  return forTiming.resolve(trip, post, layers, timing);
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
  return resolvedForTiming(trip, post, layers, timing).seconds > 0;
}

/** Whether the opener on the slide carrying the piece's badge plays anything. */
export function hookMoves(trip: TripDoc, post: TripPost): boolean {
  const lead = leadSlideOf(post);
  return lead ? openerMoves(trip, post, lead.hook, slideHookTiming(post, lead)) : false;
}

/** The timing of the slide carrying the piece's badge — what an opener is told by default. */
function leadTiming(post: TripPost): HookTiming {
  const lead = leadSlideOf(post);
  return lead
    ? slideHookTiming(post, lead)
    : { durationSeconds: post.badge.durationSeconds, screenSeconds: post.badge.durationSeconds, counterMode: post.badge.mode };
}
