/**
 * Where Virée is AT SEA, and when its car drives aboard and off a ferry, on
 * its own clock — the stretches the deck band stripes on the slide's cell
 * (face A of the sailing stripe, his pick 2026-10-14). The band knew the
 * opener's length and its shortest beat; it could not say whether a slide's
 * end fell in the middle of the crossing that started all of
 * `docs/slide-length.md`.
 *
 * Read off the plan the paint already draws: the docks are the schedule's
 * own beats, and a run is at sea wherever the road's vehicle there is a boat
 * (a ferry carrying the car, the water rule's boat, a piece that borrows one).
 * The run's easing maps time to arc length unevenly, so the run is SAMPLED
 * rather than cut by proportion.
 *
 * Pure and DOM-free.
 */

import type { DriveMoment, DriveSchedule } from './drive-plan';
import type { HookSpan } from './hook-variant';

/** How finely a run is sampled, in seconds of the opener's clock. */
const STEP_SECONDS = 1 / 60;

/** The marks of one drive: its docks, then its stretches at sea, in time order. */
export function sailSpans(
  plan: { seconds: number; schedule: Pick<DriveSchedule, 'docks'>; at(t: number): Pick<DriveMoment, 's' | 'phase'> },
  atSea: (s: number) => boolean,
): HookSpan[] {
  const out: HookSpan[] = plan.schedule.docks.map((dock) => ({ kind: dock.kind, start: dock.start, end: dock.end }));
  let open: number | null = null;
  const steps = Math.max(1, Math.ceil(plan.seconds / STEP_SECONDS));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * plan.seconds;
    const m = plan.at(t);
    const sea = m.phase === 'run' && atSea(m.s);
    if (sea && open === null) open = t;
    if (!sea && open !== null) {
      out.push({ kind: 'sail', start: open, end: t });
      open = null;
    }
  }
  if (open !== null) out.push({ kind: 'sail', start: open, end: plan.seconds });
  return out.filter((span) => span.end - span.start > 1e-6).sort((a, b) => a.start - b.start);
}
