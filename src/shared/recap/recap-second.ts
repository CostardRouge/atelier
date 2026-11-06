/**
 * ONE SECOND A DAY (lab 7, his yes of 2026-11-06): a period — a month by
 * default — as a film of one second per day, the video twin of the month
 * calendar. Each day with a picture is a page of its own: a clip plays the
 * second from its middle, a Live Photo plays its motion (its clip joins the
 * pool when the recap fills), a still breathes — a slow push-in — and the day
 * stands in a corner. A day with nothing is skipped, never shown black.
 *
 * The plan is its own (`secondPlan`): pages back to back, `motion.hold`
 * seconds each, cut on the frame; `planFilm` then applies the author's length,
 * the opener and the beat as for any recap.
 *
 * Pure and DOM-free.
 */

import type { RecapDoc } from './recap-doc';
import type { RecapLayout } from './recap-layout';
import type { ClipLength, FilmPlan, PagePlan } from './recap-motion';

/** The seconds a day lasts: `motion.hold`, kept within what reads as «a second». */
export const SECOND_RANGE = { min: 0.5, max: 3 } as const;
export const secondOf = (doc: Pick<RecapDoc, 'motion'>) => Math.min(SECOND_RANGE.max, Math.max(SECOND_RANGE.min, doc.motion.hold));

/** Where a clip's second starts: its middle, inside the clip. */
export function secondIn(duration: number, len: number): number {
  if (!(duration > len)) return 0;
  return Math.max(0, Math.min(duration - len, duration / 2 - len / 2));
}

/** How far a still is pushed in at `u` (0 → 1 through its second): 1 → 1.05, eased out. */
export const pushIn = (u: number) => 1 + 0.05 * (1 - (1 - Math.min(1, Math.max(0, u))) ** 2);

/**
 * The film of a one-second-a-day: each page `len` seconds, its cell on from
 * its first frame, its clip playing its middle second; the first page's
 * heading fading in over it.
 */
export function secondPlan(doc: RecapDoc, layout: RecapLayout, clipLength: ClipLength, len: number = secondOf(doc)): FilmPlan {
  const pages: PagePlan[] = layout.pages.map((page, i) => {
    const start = i * len;
    const cells = new Map<string, { at: number; dur: number }>();
    const clips = new Map<string, { from: number; to: number; offset?: number }[]>();
    for (const part of page.parts) {
      if (part.kind !== 'cell') continue;
      cells.set(part.id, { at: start, dur: 0 });
      const d = clipLength(part.id);
      if (d && d > 0) clips.set(part.id, [{ from: start, to: start + len, offset: secondIn(d, len) }]);
    }
    const heading = page.parts.some((p) => p.kind === 'text' && p.role === 'heading') ? { at: start, dur: Math.min(0.4, len / 2) } : null;
    const subheading = { at: start, dur: 0 };
    return { start, length: len, heading, subheading, cta: null, cells, clips, allOn: start + (heading ? heading.dur : 0) };
  });
  return { pages, total: Math.max(0.5, pages.length * len) };
}
