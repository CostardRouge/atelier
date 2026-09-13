/**
 * The scrub's driver — «&nbsp;Défilé&nbsp;» as arithmetic.
 *
 * One number runs the whole opener: the seconds since the hook began. This
 * module turns it into the ONE thing every follower reads — which stop the
 * reading head has reached, where along the tape it sits, and how long ago it
 * landed — so the flashed picture, the passed ticks, the numeral and (later)
 * the tick in the ear are four readings of one array and cannot disagree.
 *
 * Two decisions live here rather than in a comment elsewhere:
 *
 * - **Only told days flash.** A stop is a day another piece already tells;
 *   a day nothing was ever posted from is crossed by the head, never shown,
 *   never faked. A trip with nothing told yet still sweeps — through evenly
 *   spaced days that flash nothing — so the tape reads the trip's length even
 *   on its first piece.
 * - **Deceleration is the feel.** Stops are placed on the inverse of a cubic
 *   ease-out, so the last few days take as long as the first twenty: a
 *   mechanism coming to rest rather than a slideshow ending. The head's glide
 *   uses the same curve, which is what makes it sit EXACTLY on a stop at that
 *   stop's time rather than near it.
 *
 * Pure and DOM-free. Design: `docs/hook-engine.md`.
 */

import type { HookDay } from './hook-variant';

export type ScrubMode = 'from-start' | 'run-up';
export type TapePosition = 'bottom' | 'top';

export interface ScrubOptions {
  /** Sweep the whole trip from day 1, or only the days just before this one. */
  mode: ScrubMode;
  /** Run-up only: how many told days before this one the sweep starts from. */
  runUpDays: number;
  /** The most stops a sweep makes, the hero's own included. */
  maxStops: number;
  /** How long the sweep takes to come to rest. */
  sweepSeconds: number;
  /** Flash the told days' pictures as the head passes them. */
  flash: boolean;
  /** Where the tape runs. */
  tape: TapePosition;
}

export const SCRUB_DEFAULTS: ScrubOptions = {
  mode: 'from-start',
  runUpDays: 8,
  maxStops: 12,
  sweepSeconds: 1.9,
  flash: true,
  tape: 'bottom',
};

/** The bounds each option is clamped to — a stored value is never trusted. */
export const SCRUB_LIMITS = {
  runUpDays: { min: 2, max: 30 },
  maxStops: { min: 3, max: 16 },
  sweepSeconds: { min: 0.8, max: 4 },
} as const;

/** One place the head comes to rest. */
export interface ScrubStop {
  date: string;
  dayNumber: number;
  /** Seconds into the hook at which the head lands here. */
  at: number;
  /** Another piece tells this day, so it has a picture to flash. */
  told: boolean;
  /** A leg of the trip starts on this day. */
  legStart: boolean;
  /** The day this piece tells — the picture already on the frame, never flashed. */
  hero: boolean;
}

export interface ScrubPlan {
  totalDays: number;
  stops: readonly ScrubStop[];
  /** Day numbers a leg starts on — the tape's long ticks. */
  legStarts: readonly number[];
  /** Seconds the sweep takes; 0 when there is nowhere to sweep from. */
  sweepSeconds: number;
  /** Which stop the head last reached. */
  stopAt(t: number): number;
  /** The (fractional) day number under the head. */
  headDayAt(t: number): number;
  /** Seconds since the head last landed — drives the shutter dip. */
  sinceStopAt(t: number): number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

/** A stored options record, read through the defaults and clamped. */
export function scrubOptions(raw: Readonly<Record<string, unknown>>): ScrubOptions {
  const o = { ...SCRUB_DEFAULTS, ...raw } as ScrubOptions;
  return {
    mode: o.mode === 'run-up' ? 'run-up' : 'from-start',
    runUpDays: Math.round(
      clamp(Number(o.runUpDays), SCRUB_LIMITS.runUpDays.min, SCRUB_LIMITS.runUpDays.max),
    ),
    maxStops: Math.round(
      clamp(Number(o.maxStops), SCRUB_LIMITS.maxStops.min, SCRUB_LIMITS.maxStops.max),
    ),
    sweepSeconds: clamp(
      Number(o.sweepSeconds),
      SCRUB_LIMITS.sweepSeconds.min,
      SCRUB_LIMITS.sweepSeconds.max,
    ),
    flash: o.flash !== false,
    tape: o.tape === 'top' ? 'top' : 'bottom',
  };
}

/**
 * `k` items spread evenly over `items`, first and last always kept. Fewer than
 * `k` comes back whole: a sweep never repeats a day to reach a count.
 */
export function sampleEvenly<T>(items: readonly T[], k: number): T[] {
  if (k <= 0) return [];
  if (items.length <= k) return [...items];
  if (k === 1) return [items[items.length - 1]];
  const out: T[] = [];
  for (let i = 0; i < k; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (k - 1))]);
  }
  return out;
}

/** The time a stop is reached, as a fraction of the sweep: the ease's inverse. */
export function stopFraction(index: number, count: number): number {
  if (count <= 1) return 1;
  const p = index / (count - 1);
  return 1 - Math.cbrt(1 - p);
}

/** How far through the stops the head is, as a fractional index. */
function progress(t: number, sweep: number, count: number): number {
  if (count <= 1 || sweep <= 0) return Math.max(0, count - 1);
  const u = clamp(t / sweep, 0, 1);
  return (1 - (1 - u) ** 3) * (count - 1);
}

/**
 * The days a sweep stops on, the hero last — or null when this piece's day is
 * not a day of the trip at all.
 *
 * The pool is the TOLD days before this one. When it is empty the sweep still
 * runs, through evenly spaced untold days, so a first piece reads the trip's
 * length too; those stops flash nothing because there is nothing to flash.
 */
export function scrubStopDays(
  calendar: readonly HookDay[],
  date: string,
  opts: ScrubOptions,
): HookDay[] | null {
  const heroIndex = calendar.findIndex((day) => day.date === date);
  if (heroIndex < 0) return null;
  const hero = calendar[heroIndex];
  const before = calendar.slice(0, heroIndex);
  const budget = opts.maxStops - 1;

  let picks: HookDay[];
  if (opts.mode === 'run-up') {
    const told = before.filter((day) => day.told);
    picks = told.length
      ? told.slice(-Math.min(opts.runUpDays, budget))
      : sampleEvenly(before.slice(-opts.runUpDays), Math.min(budget, opts.runUpDays));
  } else {
    const told = before.filter((day) => day.told);
    picks = told.length ? sampleEvenly(told, budget) : sampleEvenly(before, Math.min(budget, 6));
    // A sweep from the start STARTS at the start: the head leaves day 1 even
    // when nothing was told there, or the tape's first stretch is never read.
    if (before.length && picks[0]?.date !== before[0].date) {
      picks = [before[0], ...(budget > 1 ? picks.slice(-(budget - 1)) : [])];
    }
  }
  return [...picks, hero];
}

/** The scrub, planned: stops, their times, and the readings a frame needs. */
export function scrubPlan(
  calendar: readonly HookDay[],
  date: string,
  opts: ScrubOptions,
): ScrubPlan | null {
  const days = scrubStopDays(calendar, date, opts);
  if (!days) return null;

  const count = days.length;
  const sweep = count > 1 ? opts.sweepSeconds : 0;
  const stops: ScrubStop[] = days.map((day, i) => ({
    date: day.date,
    dayNumber: day.dayNumber,
    at: sweep * stopFraction(i, count),
    told: i < count - 1 && day.told,
    legStart: day.legStart,
    hero: i === count - 1,
  }));

  const stopAt = (t: number) => Math.min(count - 1, Math.floor(progress(t, sweep, count) + 1e-9));

  return {
    totalDays: calendar.length,
    stops,
    legStarts: calendar.filter((day) => day.legStart).map((day) => day.dayNumber),
    sweepSeconds: sweep,
    stopAt,
    headDayAt(t) {
      const f = progress(t, sweep, count);
      const i = Math.min(count - 1, Math.floor(f));
      const next = stops[Math.min(count - 1, i + 1)];
      return stops[i].dayNumber + (next.dayNumber - stops[i].dayNumber) * (f - i);
    },
    sinceStopAt(t) {
      return t - stops[stopAt(t)].at;
    },
  };
}

/**
 * Where a day sits along the tape, as a fraction 0..1 of its length. A trip of
 * one day puts it at the start, rather than dividing by zero.
 */
export function tapeFraction(dayNumber: number, totalDays: number): number {
  if (totalDays <= 1) return 0;
  return clamp((dayNumber - 1) / (totalDays - 1), 0, 1);
}

/**
 * The day numbers that get a tick on a tape `lengthPx` long. Every day while
 * ticks stay `minGapPx` apart, every k-th day past that — the start and every
 * leg start always, since those are the ticks that carry meaning.
 */
export function tapeTicks(
  totalDays: number,
  lengthPx: number,
  legStarts: readonly number[],
  minGapPx = 5,
): number[] {
  if (totalDays <= 0) return [];
  const perDay = totalDays > 1 ? lengthPx / (totalDays - 1) : lengthPx;
  const step = Math.max(1, Math.ceil(minGapPx / Math.max(perDay, 1e-6)));
  const ticks = new Set<number>([1, totalDays, ...legStarts]);
  for (let day = 1; day <= totalDays; day += step) ticks.add(day);
  return [...ticks].filter((d) => d >= 1 && d <= totalDays).sort((a, b) => a - b);
}
