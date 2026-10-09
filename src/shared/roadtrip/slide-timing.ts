/**
 * How long a slide is on screen against what it carries — rule D of the
 * slide-duration lab (2026-10-07, his pick of its recommendations).
 *
 * A slide's length is ONE number written in two places (the band's grips,
 * the Content tab's «On screen»). What sits on the slide falls into three
 * families: a picture's MOTION shares the slide's length and never conflicts;
 * an OPENER (Itinerary, Virée, Défilé) and the badge's exit have a length of
 * their own; a CLIP is bounded by its source. Before this module an opener
 * longer than its slide was cut in the file and said so in a red sentence in
 * another tab, with nothing to press.
 *
 * The rule:
 * - **Auto** — a slide that has not been set by hand lasts what its opener
 *   needs plus a short hold (`AUTO_TAIL_SECONDS`); with no opener, the badge's
 *   own life plus a beat, as `defaultHookSeconds` always gave. Nothing is
 *   ever cut under Auto.
 * - **Set by you** — dragging a grip or the slider fixes the length, the
 *   gesture keeping the sense of CUT it has (a timeline's edge cuts; stretching
 *   is a tool of its own). An opener that overflows is then shown hatched on
 *   the band and said beside the slider with two verbs: back to Auto, or FIT
 *   the opener to the slide.
 * - **Fit** is a setting OF THE OPENER, stored with it, so it follows the
 *   slide's length when that changes later — under a floor: a picture never
 *   shows for less than `FIT_FLOOR_SECONDS`, below which the fit is refused
 *   and the panel says why.
 * - **Existing pieces do not change**: a slide with no `auto` mark is fixed at
 *   its stored length; only a NEW slide is born in Auto.
 * - The badge's EXIT lands on the slide's end, not on an absolute life — so
 *   shortening a slide never cuts an exit and an Auto slide aligns by itself.
 *
 * Pure and DOM-free.
 */

import { MAX_HOOK_SECONDS, MIN_HOOK_SECONDS } from './hook-video';
import type { HookRender } from './hooks/hook-variant';

/** The hold a picture keeps once its opener has rested, under Auto. */
export const AUTO_TAIL_SECONDS = 0.5;
/** The least a picture may be looked at once an opener is fitted; below it the fit is refused. */
export const FIT_FLOOR_SECONDS = 0.35;

/** Who decided the slide's length. */
export type SecondsOwner = 'auto' | 'set';

export interface SlideTiming {
  /** What the slide is on screen for. */
  seconds: number;
  owner: SecondsOwner;
  /** What the opener occupies (0 for none). */
  openerSeconds: number;
  /** Seconds of the opener the slide would cut — 0 under Auto, or when it fits. */
  overflow: number;
  /** Seconds the picture holds past the opener, under Auto. */
  held: number;
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * The length Auto gives: the opener plus its hold — else the slide's own
 * stored seconds, which is what a slide with nothing timed on it always
 * lasted (a new piece's `defaultHookSeconds`, a new slide's 3 s); inside the
 * control's own bounds and the clip's ceiling.
 */
export function autoSeconds(openerSeconds: number, storedSeconds: number, ceiling = MAX_HOOK_SECONDS): number {
  const wanted = openerSeconds > 0 ? openerSeconds + AUTO_TAIL_SECONDS : storedSeconds;
  return clamp(wanted, MIN_HOOK_SECONDS, Math.min(MAX_HOOK_SECONDS, Math.max(MIN_HOOK_SECONDS, ceiling)));
}

/** A slide's timing: Auto follows the opener, a set length is what it is. */
export function slideTiming(
  auto: boolean,
  storedSeconds: number,
  openerSeconds: number,
  ceiling = MAX_HOOK_SECONDS,
): SlideTiming {
  const opener = Math.max(0, openerSeconds);
  if (auto) {
    const seconds = autoSeconds(opener, storedSeconds, ceiling);
    return { seconds, owner: 'auto', openerSeconds: opener, overflow: Math.max(0, opener - seconds), held: Math.max(0, seconds - opener) };
  }
  const seconds = clamp(storedSeconds, MIN_HOOK_SECONDS, Math.min(MAX_HOOK_SECONDS, Math.max(MIN_HOOK_SECONDS, ceiling)));
  return { seconds, owner: 'set', openerSeconds: opener, overflow: Math.max(0, opener - seconds), held: 0 };
}

/** The time scale that fits an opener into a slide: 1 when it already fits. */
export function fitScale(openerSeconds: number, slideSeconds: number): number {
  if (!(openerSeconds > 0) || !(slideSeconds > 0) || slideSeconds >= openerSeconds) return 1;
  return slideSeconds / openerSeconds;
}

/**
 * Why a fit is refused, or null: the opener's shortest beat — a picture's
 * time on screen, a day's flash — scaled, must not fall under the floor.
 */
export function fitRefusal(scale: number, shortestBeat: number): string | null {
  if (scale >= 1) return null;
  const beat = shortestBeat * scale;
  if (beat >= FIT_FLOOR_SECONDS) return null;
  return `Fitting would show a picture for ${beat.toFixed(2)} s, under the ${FIT_FLOOR_SECONDS} s it takes to see one — the opener keeps its length.`;
}

export interface FittedRender {
  render: HookRender;
  /** 1 when nothing was scaled. */
  scale: number;
  /** Why the opener kept its length though it was asked to fit, or null. */
  refused: string | null;
}

/**
 * An opener's prepared render fitted into the slide: its clock scaled so it
 * rests when the slide ends, the content, the paint and the score reading the
 * same scaled time — unless the shortest beat would fall under the floor, in
 * which case the render is handed back as it was and `refused` says why.
 * `slideSeconds` undefined (an Auto slide) fits nothing: the slide follows.
 */
export function fitRender(render: HookRender, slideSeconds: number | undefined, shortestBeat: number): FittedRender {
  if (slideSeconds === undefined) return { render, scale: 1, refused: null };
  const scale = fitScale(render.seconds, slideSeconds);
  if (scale >= 1) return { render, scale: 1, refused: null };
  const refused = fitRefusal(scale, shortestBeat);
  if (refused) return { render, scale: 1, refused };
  const content = render.content;
  const paint = render.paint;
  const score = render.score;
  const ready = render.ready;
  return {
    scale,
    refused: null,
    render: {
      seconds: render.seconds * scale,
      ...(content ? { content: (t: number) => content(t / scale) } : {}),
      ...(paint ? { paint: (g, t, frame) => paint(g, t / scale, frame) } : {}),
      ...(ready ? { ready: (t0: number, t1?: number, signal?: AbortSignal) => ready(t0 / scale, t1 === undefined ? undefined : t1 / scale, signal) } : {}),
      ...(score ? { score: () => score().map((event) => ({ ...event, at: event.at * scale })) } : {}),
      ...(render.mixWithSource !== undefined ? { mixWithSource: render.mixWithSource } : {}),
      ...(render.badgeWindow
        ? { badgeWindow: { start: render.badgeWindow.start * scale, end: render.badgeWindow.end === null ? null : render.badgeWindow.end * scale } }
        : {}),
    },
  };
}
