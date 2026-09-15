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
 * - **A stop is a real picture, or an honest dark frame.** Stopping on the
 *   pieces' days, a stop is a day another piece already tells and flashes the
 *   SOURCE picture that piece is composed over; a day nothing was posted from
 *   is crossed by the head, never shown, never faked. A trip with nothing told
 *   yet still sweeps — through evenly spaced days that flash nothing — so the
 *   tape reads the trip's length even on its first piece.
 * - **The easing places the stops.** Stops sit on the INVERSE of the chosen
 *   curve, and the head glides on the curve itself, which is what makes it sit
 *   EXACTLY on a stop at that stop's time rather than near it. Every easing
 *   offered has a closed-form inverse for that reason. The default is a cubic
 *   ease-out — the last few days take as long as the first twenty, a mechanism
 *   coming to rest rather than a slideshow ending.
 * - **The author may pick the pictures.** `stopsOn: 'picked'` stops once per
 *   picture in `picked`, in the order they were shot, the hero appended. A day
 *   with three pictures is three stops on one tick: the head holds while the
 *   frames change. A picture shot after this piece's day, or outside the trip,
 *   has no place on the tape and is left out — and the panel says so.
 *
 * Pure and DOM-free. Design: `docs/hook-engine.md`.
 */

import type { SoundEvent } from '../../audio/sound-event';
import { EASINGS, EASING_IDS, type HookEasing } from './easing';
import {
  hookPictureKey,
  type HookDay,
  type HookPickedPicture,
  type HookPictureWant,
} from './hook-variant';
import { standingPiece } from './hook-calendar';
import { partitionPicked, readPicked, sampleEvenly } from './picked';
import { KIT_IDS, TICK_KITS, driftAt, type TickDrift, type TickKit } from './tick-kits';

// The easings and the tick kits grew here and were lifted out once the route
// wanted them too; their old names stay exported so nothing else moves.
export { EASINGS, EASING_IDS } from './easing';
export { TICK_KITS as SCRUB_KITS, KIT_IDS, DRIFT_SPAN, driftAt } from './tick-kits';

export type ScrubMode = 'from-start' | 'run-up';
export type TapePosition = 'bottom' | 'top';
/** How the head travels — see `EASINGS`. */
export type ScrubEasing = HookEasing;
/** What the sweep stops on: the days other pieces tell, or the pictures picked. */
export type ScrubStopsOn = 'pieces' | 'picked';
/** Which voices the ticks are played on — see `tick-kits.ts`. */
export type ScrubKit = TickKit;
/** How the ticks' pitch moves along the sweep. */
export type ScrubDrift = TickDrift;
/** The shape of the reading head. */
export type ScrubHead = 'bar' | 'dot' | 'needle';

export interface ScrubOptions {
  /** What the sweep stops on — see {@link ScrubStopsOn}. */
  stopsOn: ScrubStopsOn;
  /** `picked` only: the pictures, in any order — the plan sorts them by capture. */
  picked: HookPickedPicture[];
  /** `pieces` only: sweep the whole trip from day 1, or only the days just before this one. */
  mode: ScrubMode;
  /** Run-up only: how many told days before this one the sweep starts from. */
  runUpDays: number;
  /** `pieces` only: the most stops a sweep makes, the hero's own included. */
  maxStops: number;
  /** How long the sweep takes to come to rest. */
  sweepSeconds: number;
  /** How the head travels from the first stop to the last. */
  easing: ScrubEasing;
  /** Seconds the frame holds on the first stop before the head moves. */
  delaySeconds: number;
  /** Flash each stop's picture as the head lands on it. */
  flash: boolean;
  /** Where the tape runs. */
  tape: TapePosition;
  /** The tape's length as a share of the frame's width, centred. */
  tapeWidth: number;
  /** How far the tape sits from its edge, as a share of the frame's height. */
  edgeOffset: number;
  /** Ticks and track, `#rrggbb`. */
  tickColor: string;
  /** The head and every tick it has passed, `#rrggbb`. */
  passedColor: string;
  /** Opacity of the ticks still ahead and of the track. */
  tickOpacity: number;
  /** Tick height, 1 as designed. */
  tickHeight: number;
  /** The least room between two ticks, in 1080-frame units — the tape's density. */
  tickGap: number;
  /** The thin line the ticks stand on. */
  showTrack: boolean;
  /** A dark band behind the tape, for a tape over a bright picture. */
  tapeBackground: boolean;
  backgroundOpacity: number;
  /** Ticks and track fading out over the tape's two ends. */
  edgeFade: boolean;
  headStyle: ScrubHead;
  /** The head's glow — one shadow blur a frame. */
  headGlow: boolean;
  /** Tick at every landing, in the exported video. */
  sound: boolean;
  /** How loud the ticks are: 1 as designed, 0 silent, up to 2. */
  tickVolume: number;
  /** The voices the landings are played on. */
  kit: ScrubKit;
  /** Pitch of every tick: 1 as designed, 2 an octave up, 0.5 an octave down. */
  tickPitch: number;
  /** Whether the pitch climbs, falls or stays as the head slows. */
  pitchDrift: ScrubDrift;
  /** Over a clip with its own sound: mix the ticks in rather than leave them out. */
  mixWithClip: boolean;
}

export const SCRUB_DEFAULTS: ScrubOptions = {
  stopsOn: 'pieces',
  picked: [],
  mode: 'from-start',
  runUpDays: 8,
  maxStops: 12,
  sweepSeconds: 1.9,
  easing: 'ease-out',
  delaySeconds: 0,
  flash: true,
  tape: 'bottom',
  tapeWidth: 0.86,
  edgeOffset: 0.045,
  tickColor: '#ffffff',
  passedColor: '#d9442a',
  tickOpacity: 0.55,
  tickHeight: 1,
  tickGap: 6,
  showTrack: true,
  tapeBackground: false,
  backgroundOpacity: 0.45,
  edgeFade: false,
  headStyle: 'bar',
  headGlow: true,
  sound: true,
  tickVolume: 1,
  kit: 'ratchet',
  tickPitch: 1,
  pitchDrift: 'flat',
  mixWithClip: false,
};

/** The bounds each option is clamped to — a stored value is never trusted. */
export const SCRUB_LIMITS = {
  runUpDays: { min: 2, max: 30 },
  tickVolume: { min: 0, max: 2 },
  maxStops: { min: 3, max: 16 },
  sweepSeconds: { min: 0.8, max: 4 },
  delaySeconds: { min: 0, max: 2 },
  tickPitch: { min: 0.5, max: 2 },
  tapeWidth: { min: 0.4, max: 1 },
  edgeOffset: { min: 0.02, max: 0.2 },
  tickOpacity: { min: 0.15, max: 1 },
  tickHeight: { min: 0.4, max: 2.5 },
  tickGap: { min: 3, max: 30 },
  backgroundOpacity: { min: 0.1, max: 0.9 },
} as const;

/**
 * The most pictures a picked sweep stops on, the hero's own not counted. Past
 * it the list is thinned evenly — the first and the last kept — rather than
 * cut: at four seconds that is already a tenth of a second a picture.
 */
export const PICKED_MAX_STOPS = 40;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** `#rrggbb` → `rgba(r,g,b,a)`; anything unreadable is white, never a throw. */
export { hexToRgba } from './colour';

/**
 * Where the tape sits on a frame of `w`×`h`: its two ends, its baseline, and
 * which way its ticks grow (away from the frame's edge, into the picture).
 * `u` is the 1080-frame unit every drawn size is in.
 */
export function tapeGeometry(
  w: number,
  h: number,
  opts: Pick<ScrubOptions, 'tape' | 'tapeWidth' | 'edgeOffset'>,
): { x0: number; x1: number; length: number; baseline: number; dir: 1 | -1; u: number } {
  const length = w * opts.tapeWidth;
  const x0 = (w - length) / 2;
  const top = opts.tape === 'top';
  return {
    x0,
    x1: x0 + length,
    length,
    baseline: top ? h * opts.edgeOffset : h * (1 - opts.edgeOffset),
    dir: top ? 1 : -1,
    u: w / 1080,
  };
}

/** How much of the tape's length each end fades over, when the fade is on. */
export const EDGE_FADE_SHARE = 0.14;

/**
 * The alpha factor at `x` along a tape from `x0` to `x1`: 1 everywhere with the
 * fade off; with it on, a smooth ramp from 0 at either end to 1 past
 * `EDGE_FADE_SHARE` of the length. Ticks, track and band all read it, so they
 * fade as one thing.
 */
export function edgeFadeAt(x: number, x0: number, x1: number, fade: boolean): number {
  if (!fade) return 1;
  const length = x1 - x0;
  if (length <= 0) return 1;
  const ramp = length * EDGE_FADE_SHARE;
  const d = Math.min(x - x0, x1 - x);
  if (d <= 0) return 0;
  if (d >= ramp) return 1;
  const t = d / ramp;
  return t * t * (3 - 2 * t);
}



/** One place the head comes to rest. */
export interface ScrubStop {
  date: string;
  dayNumber: number;
  /** Seconds into the hook at which the head lands here. */
  at: number;
  /**
   * The stop has a picture to flash: another piece tells the day, or the
   * author picked a picture shot on it. Never the hero.
   */
  told: boolean;
  /** The picture this stop flashes (`hookPictureKey`), or null for none. */
  pictureKey: string | null;
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
  /** Seconds the head is in MOTION; 0 when there is nowhere to sweep from. */
  sweepSeconds: number;
  /** Seconds the frame holds on the first stop before the head moves. */
  delaySeconds: number;
  /**
   * When the head comes to rest — the delay plus the sweep. What the opener's
   * life is, what the paint reads for "still sweeping", 0 for a sweep of one.
   */
  endSeconds: number;
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

/** Like `clamp`, but an unreadable value falls back to `fallback`, not to `min`. */
function clampOr(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** A stored options record, read through the defaults and clamped. */
export function scrubOptions(raw: Readonly<Record<string, unknown>>): ScrubOptions {
  const o = { ...SCRUB_DEFAULTS, ...raw } as ScrubOptions;
  return {
    stopsOn: o.stopsOn === 'picked' ? 'picked' : 'pieces',
    picked: readPicked(o.picked),
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
    easing: (EASING_IDS as readonly string[]).includes(o.easing) ? o.easing : 'ease-out',
    delaySeconds: clampOr(
      Number(o.delaySeconds),
      SCRUB_LIMITS.delaySeconds.min,
      SCRUB_LIMITS.delaySeconds.max,
      SCRUB_DEFAULTS.delaySeconds,
    ),
    flash: o.flash !== false,
    tape: o.tape === 'top' ? 'top' : 'bottom',
    tapeWidth: clampOr(Number(o.tapeWidth), SCRUB_LIMITS.tapeWidth.min, SCRUB_LIMITS.tapeWidth.max, SCRUB_DEFAULTS.tapeWidth),
    edgeOffset: clampOr(Number(o.edgeOffset), SCRUB_LIMITS.edgeOffset.min, SCRUB_LIMITS.edgeOffset.max, SCRUB_DEFAULTS.edgeOffset),
    tickColor: typeof o.tickColor === 'string' && HEX_COLOR.test(o.tickColor) ? o.tickColor.toLowerCase() : SCRUB_DEFAULTS.tickColor,
    passedColor: typeof o.passedColor === 'string' && HEX_COLOR.test(o.passedColor) ? o.passedColor.toLowerCase() : SCRUB_DEFAULTS.passedColor,
    tickOpacity: clampOr(Number(o.tickOpacity), SCRUB_LIMITS.tickOpacity.min, SCRUB_LIMITS.tickOpacity.max, SCRUB_DEFAULTS.tickOpacity),
    tickHeight: clampOr(Number(o.tickHeight), SCRUB_LIMITS.tickHeight.min, SCRUB_LIMITS.tickHeight.max, SCRUB_DEFAULTS.tickHeight),
    tickGap: clampOr(Number(o.tickGap), SCRUB_LIMITS.tickGap.min, SCRUB_LIMITS.tickGap.max, SCRUB_DEFAULTS.tickGap),
    showTrack: o.showTrack !== false,
    tapeBackground: o.tapeBackground === true,
    backgroundOpacity: clampOr(Number(o.backgroundOpacity), SCRUB_LIMITS.backgroundOpacity.min, SCRUB_LIMITS.backgroundOpacity.max, SCRUB_DEFAULTS.backgroundOpacity),
    edgeFade: o.edgeFade === true,
    headStyle: o.headStyle === 'dot' || o.headStyle === 'needle' ? o.headStyle : 'bar',
    headGlow: o.headGlow !== false,
    sound: o.sound !== false,
    tickVolume: clampOr(
      Number(o.tickVolume),
      SCRUB_LIMITS.tickVolume.min,
      SCRUB_LIMITS.tickVolume.max,
      SCRUB_DEFAULTS.tickVolume,
    ),
    kit: (KIT_IDS as readonly string[]).includes(o.kit) ? o.kit : 'ratchet',
    tickPitch: clampOr(
      Number(o.tickPitch),
      SCRUB_LIMITS.tickPitch.min,
      SCRUB_LIMITS.tickPitch.max,
      SCRUB_DEFAULTS.tickPitch,
    ),
    pitchDrift: o.pitchDrift === 'rising' || o.pitchDrift === 'falling' ? o.pitchDrift : 'flat',
    mixWithClip: o.mixWithClip === true,
  };
}

/**
 * The time a stop is reached, as a fraction of the sweep: the easing's
 * inverse at the stop's share of the way. The first stop is at 0, the last at 1.
 */
export function stopFraction(index: number, count: number, easing: ScrubEasing = 'ease-out'): number {
  if (count <= 1) return 1;
  const p = index / (count - 1);
  return clamp(EASINGS[easing].inverse(p), 0, 1);
}

/** How far through the stops the head is, as a fractional index. */
function progress(
  t: number,
  delay: number,
  sweep: number,
  count: number,
  easing: ScrubEasing,
): number {
  if (count <= 1 || sweep <= 0) return Math.max(0, count - 1);
  const u = clamp((t - delay) / sweep, 0, 1);
  return EASINGS[easing].ease(u) * (count - 1);
}

/**
 * One stop before it is timed: the day it sits on, and the picture it asks the
 * shell for. The hero's seed asks for nothing — its picture is the frame.
 */
export interface ScrubSeed {
  day: HookDay;
  want: HookPictureWant | null;
  /** A leg starts here AND this is the first stop on that day. */
  legStart: boolean;
}

// The picked list's reading, its shot order, where each picture falls against
// a piece and the even thinning live beside the contract since the drive
// wanted them too (`picked.ts`); the old names stay exported here.
export { partitionPicked, sampleEvenly, sortPicked } from './picked';

/**
 * The stops a sweep makes, the hero last — or null when this piece's day is
 * not a day of the trip at all.
 *
 * On the pieces' days, the pool is the TOLD days before this one. When it is
 * empty the sweep still runs, through evenly spaced untold days, so a first
 * piece reads the trip's length too; those stops flash nothing because there
 * is nothing to flash. On picked pictures, it is one stop a picture.
 */
export function scrubSeeds(
  calendar: readonly HookDay[],
  date: string,
  opts: ScrubOptions,
): ScrubSeed[] | null {
  const heroIndex = calendar.findIndex((day) => day.date === date);
  if (heroIndex < 0) return null;
  const hero = calendar[heroIndex];
  const heroSeed: ScrubSeed = { day: hero, want: null, legStart: hero.legStart };

  if (opts.stopsOn === 'picked') {
    const byDate = new Map(calendar.map((day) => [day.date, day]));
    const kept = sampleEvenly(partitionPicked(calendar, date, opts.picked).inReach, PICKED_MAX_STOPS);
    let lastDate = '';
    const seeds = kept.map((picture): ScrubSeed => {
      const day = byDate.get(picture.date)!;
      const first = picture.date !== lastDate;
      lastDate = picture.date;
      return {
        day,
        want: { key: hookPictureKey(picture.ref), ref: picture.ref },
        legStart: first && day.legStart,
      };
    });
    // The hero's tick sounds its leg only when no picture already landed there.
    return [...seeds, { ...heroSeed, legStart: hero.legStart && lastDate !== hero.date }];
  }

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
  const seeds = picks.map((day): ScrubSeed => {
    const media = day.told ? standingPiece(day) : undefined;
    return {
      day,
      want: media?.media
        ? { key: hookPictureKey(media.media), ref: media.media, atSeconds: media.videoSeconds }
        : null,
      legStart: day.legStart,
    };
  });
  return [...seeds, heroSeed];
}

/** The scrub, planned: stops, their times, and the readings a frame needs. */
export function scrubPlan(
  calendar: readonly HookDay[],
  date: string,
  opts: ScrubOptions,
): ScrubPlan | null {
  const seeds = scrubSeeds(calendar, date, opts);
  if (!seeds) return null;

  const count = seeds.length;
  const sweep = count > 1 ? opts.sweepSeconds : 0;
  // A sweep of one has nothing to wait for either: no delay, no life.
  const delay = count > 1 ? opts.delaySeconds : 0;
  const stops: ScrubStop[] = seeds.map((seed, i) => {
    const hero = i === count - 1;
    return {
      date: seed.day.date,
      dayNumber: seed.day.dayNumber,
      at: delay + sweep * stopFraction(i, count, opts.easing),
      told: !hero && (opts.stopsOn === 'picked' ? seed.want !== null : seed.day.told),
      pictureKey: hero ? null : (seed.want?.key ?? null),
      legStart: seed.legStart,
      hero,
    };
  });

  const stopAt = (t: number) =>
    Math.min(count - 1, Math.floor(progress(t, delay, sweep, count, opts.easing) + 1e-9));

  return {
    totalDays: calendar.length,
    stops,
    legStarts: calendar.filter((day) => day.legStart).map((day) => day.dayNumber),
    sweepSeconds: sweep,
    delaySeconds: delay,
    endSeconds: delay + sweep,
    stopAt,
    headDayAt(t) {
      const f = progress(t, delay, sweep, count, opts.easing);
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
 * The pictures a plan's stops flash, once each — what the variant hands the
 * shell to decode. The hero's picture is already on the frame.
 */
export function scrubWants(seeds: readonly ScrubSeed[]): HookPictureWant[] {
  const out = new Map<string, HookPictureWant>();
  for (const seed of seeds.slice(0, -1)) {
    if (seed.want && !out.has(seed.want.key)) out.set(seed.want.key, seed.want);
  }
  return [...out.values()];
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

/**
 * The sweep, heard: a sound at every landing, read off the same stops the head
 * and the pictures follow — so the ticks cannot fall between frames they belong
 * to. The cadence comes free from the deceleration: the ticks slow as the head
 * settles, and a listener knows it is arriving before reading anything.
 *
 * - an ordinary landing is the kit's tick;
 * - a landing on a day a leg starts is the kit's leg voice — the one sound
 *   carrying meaning, so the one that is different;
 * - the hero is the seat, which ends the phrase.
 *
 * Levels fall along the sweep as the mechanism slows. `volume` scales every
 * one of them, so the ticks keep their shape at any level; `pitch` transposes
 * them all, and a `drift` climbs or falls across the landings — the seat takes
 * the pitch but not the drift, since it is the phrase's end and not a step in
 * it. Because all of this is applied HERE, the editor's live playback, a
 * still's video, a silent clip's track and a mix follow the same numbers with
 * nothing else to thread. Nothing when there is nowhere to sweep from — or at
 * volume 0, which writes no track at all rather than a silent one.
 */
export function scrubScore(
  plan: ScrubPlan,
  volume = 1,
  tuning: { kit: ScrubKit; pitch: number; drift: ScrubDrift } = {
    kit: 'ratchet',
    pitch: 1,
    drift: 'flat',
  },
): SoundEvent[] {
  if (plan.sweepSeconds <= 0 || !(volume > 0)) return [];
  const kit = TICK_KITS[tuning.kit];
  const landings = Math.max(1, plan.stops.length - 1);
  return plan.stops.map((stop, i) => {
    if (stop.hero) return { at: stop.at, voice: kit.seat, gain: 0.8 * volume, rate: tuning.pitch };
    const rate = tuning.pitch * driftAt(tuning.drift, landings > 1 ? i / (landings - 1) : 0);
    const level = Math.max(0.35, 0.85 - i * 0.04) * volume;
    return stop.legStart
      ? { at: stop.at, voice: kit.leg.voice, gain: level * kit.leg.gain, rate: rate * kit.leg.rate }
      : { at: stop.at, voice: kit.tick, gain: level, rate };
  });
}
