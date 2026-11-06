/**
 * The week's seven bands, MOVING (lab 8, his yes of 2026-11-06, Focus asked
 * too): once everything is on, each day in turn takes the stage, then the
 * seven come back to equal bands to rest on the week. How a day takes it:
 *
 * - **Accordion** (the week's default, his idea): the day opens wide, the
 *   others narrow — the week stays a week;
 * - **Spotlight**: the day grows to the whole page, then folds back;
 * - **Wave**: a swell runs along the week;
 * - **Slide-through**: the bands widen to half the page and the camera slides
 *   along them, pausing on each day;
 * - **Focus**: the widths stay, the other days dim.
 *
 * **Pan inside** (a switch, under any of them): each picture drifts slowly in
 * its band. On the beat, a day lasts whole beats (`recap-beat.ts`).
 *
 * Pure and DOM-free: a box, a veil and a drift per band at a moment.
 */

import type { Box } from './recap-layout';

export type BandMotion = 'none' | 'accordion' | 'spotlight' | 'wave' | 'slide' | 'focus';
export const BAND_MOTIONS: readonly BandMotion[] = ['none', 'accordion', 'spotlight', 'wave', 'slide', 'focus'];
export const BAND_LABEL: Record<BandMotion, string> = { none: 'Still', accordion: 'Accordion', spotlight: 'Spotlight', wave: 'Wave', slide: 'Slide-through', focus: 'Focus' };
export const BAND_HINT: Record<BandMotion, string> = {
  none: 'The seven bands stay as they are',
  accordion: 'Each day opens wide in turn, the others narrow',
  spotlight: 'Each day fills the screen for a moment, then folds back',
  wave: 'A swell runs along the week',
  slide: 'The bands widen and the camera slides along the week',
  focus: 'Each day in turn stays bright, the others dim',
};
export const BAND_HOLD = { min: 0.4, max: 3 } as const;

/** When the bands move on a page: from `from`, `hold` seconds a day. */
export interface BandSpan {
  from: number;
  hold: number;
}

/** The time it takes the seven to come back to equal bands. */
export const BAND_RETURN = 0.5;
/** Seconds the bands move in all: seven days, then the return. */
export const bandSeconds = (hold: number) => 7 * hold + BAND_RETURN;

export interface BandLook {
  box: Box;
  /** A veil over the picture, 0–1. */
  dim: number;
  /** Where the picture's focus drifts, −1 … 1 of its free travel (Pan inside). */
  pan: number;
  /** Drawn over the others (Spotlight's open day). */
  top: boolean;
}

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpBox = (a: Box, b: Box, k: number): Box => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });

/** Bands laid side by side from weights, filling `x0 … x0 + width` with `gap` between them. */
function byWeights(weights: readonly number[], x0: number, width: number, gap: number, y: number, h: number): Box[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const free = width - gap * (weights.length - 1);
  let x = x0;
  return weights.map((k) => {
    const w = (free * k) / sum;
    const b = { x, y, w, h };
    x += w + gap;
    return b;
  });
}

/**
 * Each band's look at film time `t`: `boxes` are the bands as laid (left to
 * right), `W × H` the page; `span` when the days take their turns (null: the
 * bands stay, the pan alone may move).
 */
export function bandsAt(mode: BandMotion, boxes: readonly Box[], W: number, H: number, span: BandSpan | null, t: number, pan: boolean): BandLook[] {
  const n = boxes.length;
  const drift = (k: number) => (pan ? Math.sin(t * 0.55 + k * 0.9) : 0);
  const rest = boxes.map((box, k) => ({ box, dim: 0, pan: drift(k), top: false }));
  if (!span || mode === 'none' || n < 2) return rest;
  const u = (t - span.from) / span.hold;
  const end = n * span.hold;
  const back = (t - span.from - end) / BAND_RETURN;
  if (u <= 0 || back >= 1) return rest;
  const i = Math.min(n - 1, Math.floor(u));
  const f = u - Math.floor(u);
  const done = u >= n;
  const x0 = boxes[0].x;
  const width = boxes[n - 1].x + boxes[n - 1].w - x0;
  const gap = n > 1 ? Math.max(0, boxes[1].x - boxes[0].x - boxes[0].w) : 0;
  const y = boxes[0].y;
  const h = boxes[0].h;
  // How far the open day is open: opening over its first third, closing into the next (the last into the return).
  const openOf = (k: number): number => {
    if (done) return k === n - 1 ? 1 - ease(back) : 0;
    if (k === i) return ease(f / 0.35);
    if (k === i - 1) return 1 - ease(f / 0.35);
    return 0;
  };
  switch (mode) {
    case 'accordion': {
      const laid = byWeights(boxes.map((_, k) => 1 + 4.5 * openOf(k)), x0, width, gap, y, h);
      // The narrow ones a shade darker, so the open day reads first.
      const lit = Math.max(...boxes.map((_, k) => openOf(k)));
      return laid.map((box, k) => ({ box, dim: 0.12 * lit * (1 - openOf(k)), pan: drift(k), top: false }));
    }
    case 'focus': {
      const lit = Math.max(...boxes.map((_, k) => openOf(k)));
      return boxes.map((box, k) => ({ box, dim: 0.55 * lit * (1 - openOf(k)), pan: drift(k), top: false }));
    }
    case 'spotlight': {
      // In over a quarter of the day, out over its last quarter; the strip under it dims a little.
      const k = done ? -1 : i;
      const grow = done ? 0 : f < 0.3 ? ease(f / 0.3) : f > 0.75 ? 1 - ease((f - 0.75) / 0.25) : 1;
      const page = { x: 0, y: 0, w: W, h: H };
      return boxes.map((box, j) => (j === k ? { box: lerpBox(box, page, grow), dim: 0, pan: drift(j), top: true } : { box, dim: 0.15 * grow, pan: drift(j), top: false }));
    }
    case 'wave': {
      const c = done ? n + 2 * ease(back) : u;
      const weights = boxes.map((_, k) => 1 + 2.4 * Math.exp(-((k + 0.5 - c) ** 2) / 1.2));
      return byWeights(weights, x0, width, gap, y, h).map((box, k) => ({ box, dim: 0, pan: drift(k), top: false }));
    }
    case 'slide': {
      // The bands widen to half the page; the strip slides along, pausing on each day (eased steps), then folds back.
      const bw = W * 0.55;
      const travel = n * (bw + gap) - gap - width;
      const into = done ? 1 - ease(back) : ease(Math.min(1, u / 0.4));
      const step = done ? n - 1 : i + ease(Math.min(1, f / 0.5)) - 1;
      const along = Math.max(0, Math.min(1, step / Math.max(1, n - 1)));
      const wide = boxes.map((_, k) => ({ x: x0 - travel * along + k * (bw + gap), y, w: bw, h }));
      return boxes.map((box, k) => ({ box: lerpBox(box, wide[k], into), dim: 0, pan: drift(k), top: false }));
    }
  }
  return rest;
}
