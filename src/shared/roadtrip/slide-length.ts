/**
 * How long a slide is on screen, as PARTS — face B of `docs/slide-length.md`
 * (2026-10-13, his pick after «le système de longueur … incompréhensible»).
 *
 * Rule D (`slide-timing.ts`) knew two states, Auto and Set, and any gesture on
 * the length silently moved a slide from the first to the second: a ferry
 * added to Virée afterwards was then cut. Here the owner is a WORD the author
 * picks and no gesture changes it:
 *
 * - **The opener decides** (`owner: 'opener'`): the slide is the opener at a
 *   PACE, then a HOLD on the picture. The length is their sum, read — so an
 *   opener that grows (a ferry, a stop, the recap's beats) lengthens the slide
 *   by itself, keeping the author's pace and hold. With no opener on the slide
 *   it lasts its stored seconds, as Auto always did.
 * - **Fixed** (`owner: 'fixed'`): the slide lasts its stored seconds — the very
 *   `hookSeconds` / `seconds` field the band's grips and a clip's cut already
 *   write, never a second copy of it. An opener longer than that is either
 *   SPED UP to end with the slide (`over: 'fit'`) or CUT (`over: 'cut'`), the
 *   one question a fixed length asks.
 *
 * Nothing is sped up past the FLOOR — a picture is never shown for less than
 * `FIT_FLOOR_SECONDS` on the opener's shortest beat (`paceFloor`) — and the
 * only cuts are the ones the author asked for, or the ones a bound forces
 * (a fixed length under the floor, a clip's end, the 60 s ceiling), which the
 * resolution reports so a panel can say them.
 *
 * Pure and DOM-free.
 */

import { MAX_HOOK_SECONDS, MIN_HOOK_SECONDS } from './hook-video';
import { AUTO_TAIL_SECONDS, FIT_FLOOR_SECONDS } from './slide-timing';

/** What a fixed length does with an opener longer than itself. */
export type LengthOver = 'fit' | 'cut';

/** Who decides how long the slide is, and how. */
export type SlideLength =
  /** The opener at `pace` (1 = its own, ½ = twice as fast), then `hold` seconds on the picture. */
  | { owner: 'opener'; pace: number; hold: number }
  /** The slide's stored seconds; a longer opener sped up to fit them, or cut. */
  | { owner: 'fixed'; over: LengthOver };

/** The paces the inspector offers as steps; the band may set any value between the floor and 1. */
export const PACE_STEPS: readonly number[] = [0.5, 0.75, 1];

/** The fastest any opener is ever run, whatever its beats: a tenth of its time. */
export const MIN_PACE = 0.1;

/** The hold a new slide keeps once its opener has rested. */
export const DEFAULT_HOLD_SECONDS = AUTO_TAIL_SECONDS;

/** What a new slide — and a new piece's first one — is born with. */
export function defaultSlideLength(): SlideLength {
  return { owner: 'opener', pace: 1, hold: DEFAULT_HOLD_SECONDS };
}

/** A slide's length, resolved against what its opener needs. */
export interface ResolvedLength {
  owner: SlideLength['owner'];
  /** What the slide lasts. */
  seconds: number;
  /** What the opener needs at its own pace — never the sped-up length. 0 for none. */
  natural: number;
  /** What the opener occupies on the slide, sped up (`natural × scale`). */
  span: number;
  /** The pace the opener is run at: 1 at its own, under 1 when sped up. */
  scale: number;
  /** The picture's time after the opener has rested. */
  hold: number;
  /** Seconds of the (sped-up) opener the slide's end cuts off; 0 when it plays whole. */
  cut: number;
  /** The pace asked for was faster than the floor allows, so the floor was used. */
  floored: boolean;
  /** The fastest pace this opener may run at (`paceFloor`). */
  floor: number;
}

/**
 * The fastest pace an opener may run at: its shortest beat — a picture's time,
 * a stop's dwell, a day's flash — never under `FIT_FLOOR_SECONDS`. An opener
 * that reports no beat is bounded by `MIN_PACE` alone.
 */
export function paceFloor(shortestBeat: number): number {
  const byBeat = shortestBeat > 0 && Number.isFinite(shortestBeat) ? FIT_FLOOR_SECONDS / shortestBeat : 0;
  return Math.min(1, Math.max(MIN_PACE, byBeat));
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * How long the slide lasts and how its opener plays in it.
 *
 * `storedSeconds` is the slide's own field (a fixed length, or what a slide
 * with no opener lasts); `natural` and `shortestBeat` come from the opener as
 * it prepared at its own pace; `ceiling` is what a clip can deliver from its in
 * point, the control's 60 s otherwise.
 */
export function resolveLength(
  length: SlideLength,
  storedSeconds: number,
  natural: number,
  shortestBeat: number,
  ceiling = MAX_HOOK_SECONDS,
): ResolvedLength {
  const hi = Math.min(MAX_HOOK_SECONDS, Math.max(MIN_HOOK_SECONDS, ceiling));
  const n = Number.isFinite(natural) ? Math.max(0, natural) : 0;
  const floor = paceFloor(shortestBeat);
  if (n <= 0) {
    // Nothing on the slide plays: it lasts what it stores, whoever owns it.
    const seconds = clamp(storedSeconds, MIN_HOOK_SECONDS, hi);
    return { owner: length.owner, seconds, natural: 0, span: 0, scale: 1, hold: seconds, cut: 0, floored: false, floor };
  }
  if (length.owner === 'opener') {
    const wanted = clamp(length.pace, 0, 1);
    const scale = Math.max(floor, wanted);
    const span = n * scale;
    const seconds = clamp(span + Math.max(0, Number.isFinite(length.hold) ? length.hold : 0), MIN_HOOK_SECONDS, hi);
    return {
      owner: 'opener',
      seconds,
      natural: n,
      span,
      scale,
      hold: Math.max(0, seconds - span),
      cut: Math.max(0, span - seconds),
      floored: wanted < floor - 1e-9,
      floor,
    };
  }
  const seconds = clamp(storedSeconds, MIN_HOOK_SECONDS, hi);
  if (length.over === 'cut' || n <= seconds) {
    return { owner: 'fixed', seconds, natural: n, span: n, scale: 1, hold: Math.max(0, seconds - n), cut: Math.max(0, n - seconds), floored: false, floor };
  }
  // Sped up to end with the slide — down to the floor, past which the rest is cut and said.
  const wanted = seconds / n;
  const scale = Math.max(floor, wanted);
  const span = n * scale;
  return {
    owner: 'fixed',
    seconds,
    natural: n,
    span,
    scale,
    hold: Math.max(0, seconds - span),
    cut: Math.max(0, span - seconds),
    floored: wanted < floor - 1e-9,
    floor,
  };
}

/** What a drag of the slide's end on the band asks of an opener-owned length. */
export interface Negotiated {
  pace: number;
  hold: number;
  /** The end was pulled past the floor: the grip stops there. */
  stopped: boolean;
}

/**
 * One number on the band — the slide's total — read back as a pace and a
 * hold: past the opener's natural end the drag is HOLD, inside it the drag is
 * PACE, down to `floor` (the resolution's own, `paceFloor`) where it stops.
 * Within `magnet` seconds of the natural end it rests ON it (pace 1, no hold),
 * so the end can be found by hand. Hold in tenths, pace in hundredths.
 */
export function negotiate(total: number, natural: number, floor: number, magnet = 0): Negotiated {
  const t = Number.isFinite(total) ? Math.max(0, total) : 0;
  const n = Number.isFinite(natural) ? Math.max(0, natural) : 0;
  if (n <= 0) return { pace: 1, hold: round(Math.min(t, MAX_HOOK_SECONDS), 10), stopped: false };
  if (Math.abs(t - n) <= magnet) return { pace: 1, hold: 0, stopped: false };
  if (t >= n) return { pace: 1, hold: round(Math.min(t - n, MAX_HOOK_SECONDS), 10), stopped: false };
  const lo = Math.min(1, Math.max(MIN_PACE, floor));
  const pace = t / n;
  if (pace <= lo) return { pace: lo, hold: 0, stopped: true };
  return { pace: Math.max(lo, round(pace, 100)), hold: 0, stopped: false };
}

/** What a gesture on a slide's length writes: its owner kept, and the seconds only where they are the length. */
export interface LengthEdit {
  length: SlideLength;
  /** The slide's stored seconds — written only under a fixed length, or with no opener on the slide. */
  seconds?: number;
}

/**
 * A length set by hand — a grip released, a slider moved — WITHOUT changing
 * who owns it (rule 1 of `docs/slide-length.md`): under the opener's rule the
 * total is negotiated into a pace and a hold; a fixed length, or a slide with
 * no opener, takes the seconds.
 */
export function lengthByHand(length: SlideLength, timing: Pick<ResolvedLength, 'natural' | 'floor'>, total: number, magnet = 0): LengthEdit {
  if (length.owner === 'opener' && timing.natural > 0) {
    const { pace, hold } = negotiate(total, timing.natural, timing.floor, magnet);
    return { length: { owner: 'opener', pace, hold } };
  }
  return { length, seconds: total };
}

/**
 * A clip's cut IS its length: trimming a clip slide fixes it at the cut,
 * keeping a fixed length's answer to a longer opener (speed it up, by default).
 */
export function fixedFrom(length: SlideLength): SlideLength {
  return length.owner === 'fixed' ? length : { owner: 'fixed', over: 'fit' };
}

function round(value: number, per: number): number {
  return Math.round(value * per) / per;
}

/**
 * The length a slide written under rule D carries now — the v33 migration's
 * mapping, chosen so every stored slide keeps its length to the frame: an Auto
 * slide follows its opener at its own pace with rule D's half-second hold; a
 * set one is fixed at the seconds it stores, its opener sped up where the
 * opener's own *Fit to the slide* was on and cut otherwise, as it was.
 *
 * One case plays differently at the same length: a fit the floor REFUSED used
 * to leave the opener at its own pace and cut it; it now runs at the floor and
 * is cut later — more of the opener in the same seconds.
 */
export function lengthFromLegacy(auto: boolean | undefined, openerFit: boolean): SlideLength {
  if (auto === true) return defaultSlideLength();
  return { owner: 'fixed', over: openerFit ? 'fit' : 'cut' };
}

/** A stored length read back, or null when it is not one — a document from elsewhere is never trusted. */
export function readSlideLength(value: unknown): SlideLength | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.owner === 'opener') {
    const pace = typeof v.pace === 'number' && Number.isFinite(v.pace) ? clamp(v.pace, MIN_PACE, 1) : 1;
    const hold = typeof v.hold === 'number' && Number.isFinite(v.hold) ? clamp(v.hold, 0, MAX_HOOK_SECONDS) : DEFAULT_HOLD_SECONDS;
    return { owner: 'opener', pace, hold };
  }
  if (v.owner === 'fixed') return { owner: 'fixed', over: v.over === 'cut' ? 'cut' : 'fit' };
  return null;
}
