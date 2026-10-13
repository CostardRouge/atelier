/**
 * The clock an opener plays on when its slide speeds it up.
 *
 * Rule D (2026-10-07) lived here: Auto / Set, and a *Fit* each opener held in
 * its own options. Face B of `docs/slide-length.md` (2026-10-13) replaced it —
 * who decides a slide's length, its pace and its hold are `slide-length.ts`'s,
 * and the pace is applied ONCE, where an opener is resolved (`resolveHook`),
 * so no opener scales itself any more. What stays here is the one way a
 * prepared render is run faster, and the two numbers both rules share.
 *
 * Pure and DOM-free.
 */

import type { HookRender } from './hooks/hook-variant';

/** The hold a picture keeps once its opener has rested, on a new slide. */
export const AUTO_TAIL_SECONDS = 0.5;
/** The least a picture may be looked at once an opener is sped up; its shortest beat never falls under it. */
export const FIT_FLOOR_SECONDS = 0.35;

/**
 * An opener's prepared render run at `scale` (under 1 = faster): its clock
 * scaled so the content, the paint, the score, the ground's readiness and the
 * badge's window all read the same time. A scale of 1 hands it back as it was.
 */
export function scaleRender(render: HookRender, scale: number): HookRender {
  if (!(scale > 0) || scale >= 1) return render;
  const content = render.content;
  const paint = render.paint;
  const score = render.score;
  const ready = render.ready;
  return {
    seconds: render.seconds * scale,
    ...(render.shortestBeat !== undefined ? { shortestBeat: render.shortestBeat * scale } : {}),
    ...(content ? { content: (t: number) => content(t / scale) } : {}),
    ...(paint ? { paint: (g, t, frame) => paint(g, t / scale, frame) } : {}),
    ...(ready ? { ready: (t0: number, t1?: number, signal?: AbortSignal) => ready(t0 / scale, t1 === undefined ? undefined : t1 / scale, signal) } : {}),
    ...(score ? { score: () => score().map((event) => ({ ...event, at: event.at * scale })) } : {}),
    ...(render.mixWithSource !== undefined ? { mixWithSource: render.mixWithSource } : {}),
    ...(render.badgeWindow
      ? { badgeWindow: { start: render.badgeWindow.start * scale, end: render.badgeWindow.end === null ? null : render.badgeWindow.end * scale } }
      : {}),
  };
}
