/**
 * Slow motion, time-lapse, and the two clocks — pure, dependency-free, DOM-free.
 *
 * **Every clip carries two clocks.** There is *media time* — `video.currentTime`
 * and `cue.start`, the timeline of the file — and there is *capture time*, the
 * wall-clock reading DJI writes into every cue (`2026-05-30 05:49:34.609`) plus
 * its `DiffTime` between samples. On ordinary footage the two advance together.
 * On a slow-motion clip the file is *conformed*: a hundred and twenty frames a
 * second are laid down at thirty, so one second of real flight becomes four
 * seconds of media. A time-lapse does the reverse.
 *
 * **Why that breaks a HUD.** Every derived value in `motion.ts` is a rate —
 * metres divided by seconds. The metres are real (GPS), the seconds are the
 * file's, so a 4× slow-motion clip reads a quarter of the true ground speed and
 * a hyperlapse reads many times too much. Nothing else lies: a bearing is a
 * ratio of distances and survives any conform, and the clock badges read the
 * capture timestamp directly, so they tick slowly on screen — which is the
 * truth about the footage, not a bug.
 *
 * **The one number that fixes it.** {@link TimeScaleReading.scale} is capture
 * seconds per second of media: `1` for ordinary footage, `0.25` for 4× slow
 * motion, `10` for a 10× time-lapse. Feed it to `attachMotion` and every rate
 * in the app is right, because they all read the same `cue.derived`.
 *
 * **The container cannot tell us this.** A conformed file honestly declares the
 * rate it plays at (30 fps); the rate it was *shot* at is written nowhere in the
 * mp4. Only the telemetry knows, which is why this module measures rather than
 * reads — and why a clip with no `.srt` gets an honest "unknown" and a manual
 * override instead of a guess.
 */

import type { Cue } from './srt-parser';
import { parseWallClock, toEpoch } from './time-format';

/** What a clip's cadence turned out to be. */
export interface TimeScaleReading {
  /**
   * Capture seconds per second of media. `1` = real time, `< 1` = slow motion
   * (0.25 is 4× slower than life), `> 1` = time-lapse.
   */
  scale: number;
  /** Which evidence produced `scale`; `none` = nothing measurable, scale is 1. */
  basis: 'timestamps' | 'diff-time' | 'none';
  /** Cadence of the file itself, from the cue spacing. */
  mediaFps: number | null;
  /** Cadence the camera actually shot at, `mediaFps / scale`. */
  captureFps: number | null;
  /** True when the measurement landed on standard rates and was snapped to them. */
  snapped: boolean;
  /** Media seconds the measurement spans — a long baseline is a good one. */
  spanSeconds: number;
  /** How many independent samples backed it. */
  samples: number;
}

/** Ordinary footage: one second of file is one second of life. */
export const REALTIME: TimeScaleReading = {
  scale: 1,
  basis: 'none',
  mediaFps: null,
  captureFps: null,
  snapped: false,
  spanSeconds: 0,
  samples: 0,
};

/** Rates a camera actually shoots; a measurement near one of these is one. */
const STANDARD_RATES = [
  23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 200, 239.76, 240,
];

/** Within this of a standard rate (or of 1:1), the measurement *is* that value. */
const SNAP_TOLERANCE = 0.02;
/** Below this media span a pair of anchors is too short to time anything with. */
const MIN_PAIR_S = 0.15;
/**
 * Refuse the measurement when the clock's own resolution is coarser than this
 * fraction of the capture time it has to divide. Firmware that writes whole
 * seconds cannot time a five-second clip: measured error against synthetic
 * clips tracks this ratio closely (0.1 → ~0 %, 0.2 → ~5 %, 0.4 → ~17 %), so
 * the line is drawn where the answer stops being worth reporting.
 */
const MAX_QUANTISATION = 0.1;
/** A clock silent across more than this share of the clip is stalled, not slow. */
const MAX_FROZEN = 0.4;
/** Refuse to report a scale measured over less media time than this. */
const MIN_SPAN_S = 0.4;
/** Scales outside this range are a broken clock, not a creative choice. */
const MIN_SCALE = 1 / 64;
const MAX_SCALE = 600;
/** A spacing beyond this multiple of the median is a gap, not a frame step. */
const GAP_FACTOR = 3;

/** Median of a non-empty numeric list (average of the middle pair when even). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Snap to the **nearest** standard camera rate when one is within tolerance,
 * else return the measurement as-is. Nearest, not first: 29.97 and 30 are 0.1 %
 * apart, so a scan that stopped at the first candidate would round exact 30 fps
 * footage down to NTSC.
 */
export function snapRate(fps: number): { fps: number; snapped: boolean } {
  let best: number | null = null;
  let bestError = Infinity;
  for (const rate of STANDARD_RATES) {
    const error = Math.abs(fps - rate) / rate;
    if (error <= SNAP_TOLERANCE && error < bestError) {
      best = rate;
      bestError = error;
    }
  }
  return best === null ? { fps, snapped: false } : { fps: best, snapped: true };
}

/**
 * The file's own cadence, in frames per second, from the spacing between cues.
 *
 * DJI writes one cue per frame, so the spacing *is* the frame interval — but the
 * timings are quantised to the millisecond (60 fps alternates 16/17 ms), and a
 * sampled cue list (the library reads only the head and tail of a big `.srt`)
 * has a hole in the middle. Both are handled by measuring across the longest
 * *unbroken* run and dividing the span by the number of steps, which averages
 * the quantisation away instead of trusting any single interval.
 */
export function measureMediaFps(cues: readonly Cue[]): number | null {
  if (cues.length < 3) return null;
  const steps: number[] = [];
  for (let i = 1; i < cues.length; i++) {
    const d = cues[i].start - cues[i - 1].start;
    if (d > 0) steps.push(d);
  }
  if (steps.length < 2) return null;
  const typical = median(steps);
  if (!(typical > 0)) return null;

  // Longest run of consecutive cues with no gap — the sampled list's hole, and
  // any dropped block, ends a run rather than corrupting the average.
  let bestFrom = 0;
  let bestTo = 0;
  let from = 0;
  for (let i = 1; i < cues.length; i++) {
    const d = cues[i].start - cues[i - 1].start;
    if (d <= 0 || d > typical * GAP_FACTOR) {
      from = i;
      continue;
    }
    if (i - from > bestTo - bestFrom) {
      bestFrom = from;
      bestTo = i;
    }
  }
  const runSteps = bestTo - bestFrom;
  if (runSteps < 2) return null;
  const span = cues[bestTo].start - cues[bestFrom].start;
  if (!(span > 0)) return null;
  return snapRate(runSteps / span).fps;
}

/**
 * The smallest step the capture clock is seen to take, in seconds — its true
 * resolution (a millisecond firmware ticks every frame, a coarse one once a
 * second). Read from a **dense burst of consecutive cues**, never from the
 * spread-out anchors: those are seconds apart, so their smallest gap measures
 * how far apart we sampled, not what the clock can express, and using it would
 * refuse a perfectly good short clip.
 */
function clockResolution(cues: readonly Cue[], burst = 96): number {
  let previous: number | null = null;
  let smallest = Infinity;
  const end = Math.min(cues.length, burst);
  for (let i = 0; i < end; i++) {
    const wc = parseWallClock(cues[i].timestamp);
    if (!wc) continue;
    const w = toEpoch(wc);
    if (previous !== null) {
      const step = (w - previous) / 1000;
      if (step > 0) smallest = Math.min(smallest, step);
    }
    previous = w;
  }
  return smallest;
}

interface Anchor {
  /** Media seconds. */
  t: number;
  /** Capture epoch milliseconds. */
  w: number;
}

/**
 * Up to `max` cues carrying a readable capture timestamp, spread by **time**
 * rather than by index: every neighbouring pair is then at least
 * {@link MIN_PAIR_S} of media apart, which is what makes each pair a usable
 * baseline. Sampling rather than parsing all 20 000 cues keeps this cheap; the
 * last cue is always taken, so the overall baseline is the whole clip.
 */
function anchors(cues: readonly Cue[], max = 128): Anchor[] {
  const out: Anchor[] = [];
  const n = cues.length;
  if (n === 0) return out;
  const span = cues[n - 1].start - cues[0].start;
  const step = Math.max(MIN_PAIR_S, span / max);
  const push = (cue: Cue) => {
    const wc = parseWallClock(cue.timestamp);
    if (!wc) return false;
    const w = toEpoch(wc);
    if (!Number.isFinite(w)) return false;
    out.push({ t: cue.start, w });
    return true;
  };
  let nextAt = -Infinity;
  for (let i = 0; i < n; i++) {
    if (cues[i].start < nextAt) continue;
    if (push(cues[i])) nextAt = cues[i].start + step;
  }
  const last = cues[n - 1];
  if (out.length === 0 || out[out.length - 1].t !== last.start) push(last);
  return out;
}

/**
 * Capture seconds per media second, from the capture timestamps: the **median
 * slope over every pair of anchors** (Theil–Sen).
 *
 * Two failure modes rule out the obvious estimators, and this one survives both.
 * Dividing the whole baseline in one go is precise but has no defence: a single
 * cue written before the aircraft's clock was set drags the answer with it.
 * Taking the median of *neighbouring* ratios defends against that but breaks on
 * a firmware that writes whole seconds — neighbours a third of a second apart
 * then read either 0 or a full second, and the median of what survives is pure
 * quantisation, which reported an ordinary clip as a 3× time-lapse.
 *
 * All-pairs fixes both: a bad anchor poisons only a small fraction of the pairs
 * and is outvoted, while every pair keeps a long baseline. Three details earn
 * their keep, each against a measured failure:
 *
 *  - only pairs spanning at least a **quarter of the clip** vote, so a coarse
 *    clock's rounding is small next to what it divides;
 *  - a pair where the clock did not tick (`dw === 0`) **still votes**. Dropping
 *    those keeps only the pairs that rounded up, which biased every estimate
 *    upward — an ordinary five-second clip came out at 1.04, i.e. a time-lapse;
 *  - the answer is thrown away when the clock is too coarse for the job
 *    ({@link MAX_QUANTISATION}), because "not measurable" is a real answer and
 *    a 17 %-wrong cadence is not.
 */
function scaleFromTimestamps(
  a: readonly Anchor[],
  clockStep: number,
): { scale: number; span: number; samples: number } | null {
  if (a.length < 2) return null;
  const span = a[a.length - 1].t - a[0].t;
  if (span < MIN_SPAN_S) return null;

  // The clock's own resolution, or — when the burst never caught it ticking —
  // the coarsest thing the anchors can prove about it.
  let resolution = clockStep;
  let frozen = 0;
  let longestFrozen = 0;
  for (let i = 1; i < a.length; i++) {
    const step = (a[i].w - a[i - 1].w) / 1000;
    if (step > 0) {
      resolution = Math.min(resolution, step);
      frozen = 0;
    } else {
      // A run of anchors sharing one reading: quantisation if it is short,
      // a stalled clock if it swallows the clip.
      frozen += a[i].t - a[i - 1].t;
      longestFrozen = Math.max(longestFrozen, frozen);
    }
  }
  if (!Number.isFinite(resolution)) return null; // the clock never moved
  // A clock stuck across most of the clip cannot time it: the zero-slope pairs
  // would carry the median. (Quantisation never gets here — a coarse clock's
  // silent runs are bounded by its resolution, which MAX_QUANTISATION already
  // holds well under this.)
  if (longestFrozen / span > MAX_FROZEN) return null;

  const minPair = Math.max(MIN_PAIR_S, span / 4);
  const slopes: number[] = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const dt = a[j].t - a[i].t;
      if (dt < minPair) continue;
      const dw = (a[j].w - a[i].w) / 1000;
      // A clock that ran backwards over the pair is broken, not slow.
      if (dw < 0) continue;
      slopes.push(dw / dt);
    }
  }
  if (slopes.length === 0) return null;

  const scale = median(slopes);
  if (!(scale > 0)) return null;
  if (resolution / (scale * span) > MAX_QUANTISATION) return null;
  return { scale, span, samples: slopes.length };
}

/**
 * Capture seconds per media second, from DJI's `DiffTime` — the real interval
 * between two telemetry samples — against the interval the file plays them at.
 *
 * The fallback, not the first choice: it is a single firmware-written number
 * with no baseline behind it, and a firmware that conformed it along with the
 * timings would agree with the file and hide the ralenti. The timestamps are an
 * absolute clock and can be cross-checked over minutes; this cannot.
 */
function scaleFromDiffTime(
  cues: readonly Cue[],
  mediaFps: number | null,
): { scale: number; samples: number } | null {
  if (!mediaFps) return null;
  const diffs: number[] = [];
  for (const cue of cues) {
    if (cue.diffTime != null && cue.diffTime > 0) diffs.push(cue.diffTime);
  }
  if (diffs.length < 3) return null;
  const captureStep = median(diffs);
  if (!(captureStep > 0)) return null;
  const captureFps = rateWritingDiffTime(captureStep);
  if (!captureFps) return null;
  return { scale: mediaFps / captureFps, samples: diffs.length };
}

/**
 * The rate a camera shoots that would write this `DiffTime`.
 *
 * `DiffTime` is whole milliseconds, and the rates slow motion uses fall badly
 * inside a millisecond: 120 fps is 8.333 ms and gets written `8ms`, 240 fps is
 * 4.167 ms and gets written `4ms`. Dividing by the written value directly reads
 * 125 fps and 250 fps — rates no camera shoots — and lands 4 % out, twice the
 * snap tolerance, so nothing downstream can rescue it: the library would show
 * "125 fps · 4.2× slow" and every speed would run 4 % high.
 *
 * So the arithmetic is inverted: ask which standard rate, rounded the way the
 * firmware rounds, writes the millisecond we were given. Exactly one family
 * usually matches (8 ms ← 120/119.88; 4 ms ← 240/239.76), and where a family
 * has an NTSC twin 0.1 % away the integer wins. No match — nothing a camera
 * shoots writes that number — is answered with silence, not with a division.
 */
function rateWritingDiffTime(stepSeconds: number): number | null {
  const written = Math.round(stepSeconds * 1000);
  if (written <= 0) return null;
  const matches = STANDARD_RATES.filter(
    (rate) => Math.round(1000 / rate) === written,
  );
  if (matches.length === 0) return null;
  // Prefer the whole rate over its NTSC twin; they differ by 0.1 %, and the
  // integer is what a shooter recognises.
  const integer = matches.find((rate) => Number.isInteger(rate));
  return integer ?? matches[matches.length - 1];
}

/**
 * Does this cue list look like a flight log at all?
 *
 * `.srt` is a subtitle extension, and a real subtitle file sitting next to a
 * video gets paired with it like any sidecar. SDH captions even carry square
 * brackets (`[MUSIC PLAYING]`), so the parser's format sniff accepts them and
 * returns cues with no payload — whose spacing, read as a frame interval, would
 * have the library announce a film as "0.40 fps". A flight log states a frame
 * number or fields on essentially every cue; captions state neither.
 */
function looksLikeTelemetry(cues: readonly Cue[]): boolean {
  const stride = Math.max(1, Math.floor(cues.length / 32));
  let sampled = 0;
  let carrying = 0;
  for (let i = 0; i < cues.length; i += stride) {
    sampled++;
    const cue = cues[i];
    if (cue.frame != null || Object.keys(cue.data).length > 0) carrying++;
  }
  return sampled > 0 && carrying / sampled >= 0.5;
}

/**
 * Measure a clip's cadence from its telemetry.
 *
 * Accepts a full cue list or a sampled one (the library parses only the head and
 * tail of a large `.srt`): the estimators are built around endpoints and medians,
 * so a hole in the middle costs precision, never correctness. Returns
 * {@link REALTIME} — scale 1, basis `none` — whenever the evidence is missing or
 * implausible, so a caller can say "not measurable" rather than show a number
 * nobody measured.
 */
export function measureTimeScale(cues: readonly Cue[]): TimeScaleReading {
  if (cues.length < 3 || !looksLikeTelemetry(cues)) return REALTIME;
  const mediaFps = measureMediaFps(cues);

  const stamped = scaleFromTimestamps(anchors(cues), clockResolution(cues));
  const fromDiff = stamped ? null : scaleFromDiffTime(cues, mediaFps);
  const raw = stamped ?? fromDiff;
  if (!raw) return { ...REALTIME, mediaFps };

  let scale = raw.scale;
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
    return { ...REALTIME, mediaFps };
  }

  // A measurement that lands on 1 IS 1: no clip is 1.008× slow, that is jitter.
  let snapped = false;
  let captureFps: number | null = mediaFps;
  if (Math.abs(scale - 1) <= SNAP_TOLERANCE) {
    scale = 1;
    snapped = true;
  } else if (mediaFps) {
    // Prefer an exact ratio of two rates a camera really shoots (120 → 30 is
    // exactly 4×) over the measured decimal, which carries the GPS clock's
    // jitter into every readout.
    const guess = snapRate(mediaFps / scale);
    if (guess.snapped) {
      captureFps = guess.fps;
      scale = mediaFps / guess.fps;
      snapped = true;
    } else {
      captureFps = mediaFps / scale;
    }
  }

  return {
    scale,
    basis: stamped ? 'timestamps' : 'diff-time',
    mediaFps,
    captureFps,
    snapped,
    spanSeconds: stamped?.span ?? 0,
    samples: raw.samples,
  };
}

/** Anything closer to 1 than this reads as ordinary footage. */
const REALTIME_TOLERANCE = 0.02;

/** True when the clip plays at the speed it was shot. */
export function isRealtime(scale: number): boolean {
  return !Number.isFinite(scale) || Math.abs(scale - 1) <= REALTIME_TOLERANCE;
}

/** How many times slower than life the clip plays (2 = half speed). */
export function slowFactor(scale: number): number {
  return 1 / scale;
}

/**
 * `4`, `2.5`, `1.3` — a factor with no more precision than it has meaning.
 * Except near 1: a scale of 1.03 is past {@link isRealtime}'s tolerance, so it
 * has to be *shown* as 1.03 rather than rounded into the self-contradictory
 * "1× time-lapse".
 */
function factorText(factor: number): string {
  const rounded = Math.round(factor * 10) / 10;
  if (rounded === 1) return factor.toFixed(2);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * The short badge: `4× slow` / `10× fast`, or null for ordinary footage.
 * Deliberately terse — it rides in a 288 px library row beside the file facts.
 */
export function timeScaleTag(scale: number): string | null {
  if (isRealtime(scale)) return null;
  return scale < 1
    ? `${factorText(slowFactor(scale))}× slow`
    : `${factorText(scale)}× fast`;
}

/** The sentence: `4× slow motion`, `10× time-lapse`, or null at real time. */
export function describeTimeScale(scale: number): string | null {
  if (isRealtime(scale)) return null;
  return scale < 1
    ? `${factorText(slowFactor(scale))}× slow motion`
    : `${factorText(scale)}× time-lapse`;
}

/**
 * How a project answers "what cadence is this clip?".
 *
 * `auto` follows the measurement, which is right whenever the telemetry can
 * speak; `manual` is the escape hatch for the case nothing can detect — a
 * firmware that conformed its own timestamps along with the timings, or a clip
 * with no `.srt` at all. Kept as a project setting beside the capture-time
 * shift: both are corrections about the FOOTAGE, not about one badge.
 */
export interface TimeScaleSetting {
  mode: 'auto' | 'manual';
  /** Capture seconds per media second; read only when mode is `manual`. */
  scale: number;
  /**
   * The clip the override was set for. A project edits one composition but can
   * step between the clips of its working set, and a cadence typed for a
   * slow-motion clip must not silently quadruple the speeds of an ordinary one
   * next to it. Absent means "whatever is open", which only old documents mean.
   */
  clipId?: string;
}

/** Follow the telemetry — what every project starts with. */
export const AUTO_TIME_SCALE: TimeScaleSetting = { mode: 'auto', scale: 1 };

/** True when this override is the one to use for the clip now open. */
export function overrideApplies(
  setting: TimeScaleSetting | undefined,
  clipId?: string | null,
): boolean {
  if (setting?.mode !== 'manual') return false;
  if (!Number.isFinite(setting.scale) || setting.scale <= 0) return false;
  return setting.clipId == null || setting.clipId === clipId;
}

/** The scale actually in force: the author's figure, or the measured one. */
export function resolveTimeScale(
  setting: TimeScaleSetting | undefined,
  measured: TimeScaleReading,
  clipId?: string | null,
): number {
  return overrideApplies(setting, clipId) ? setting!.scale : measured.scale;
}

/**
 * The reading as it stands under `scale` — used when the author overrode the
 * measurement, so the capture rate quoted back to them follows their figure
 * instead of contradicting it.
 */
export function withScale(reading: TimeScaleReading, scale: number): TimeScaleReading {
  if (scale === reading.scale || !(scale > 0)) return reading;
  return {
    ...reading,
    scale,
    captureFps: reading.mediaFps != null ? reading.mediaFps / scale : null,
    snapped: false,
  };
}

/**
 * `120 → 30 fps` when the two differ, `60 fps` when they don't, else null.
 *
 * Null whenever the capture rate is unknown — `60 fps` on its own *states* that
 * the clip was shot at the rate it plays, which is precisely the claim an
 * unmeasurable log cannot support. A caller with only a playback rate to show
 * has to say so in its own words (the library says "plays at 30 fps — shooting
 * cadence not measurable").
 */
export function formatCadence(reading: TimeScaleReading): string | null {
  const { mediaFps, captureFps } = reading;
  if (!mediaFps || !captureFps || reading.basis === 'none') return null;
  const round = (fps: number) => (Number.isInteger(fps) ? String(fps) : fps.toFixed(2));
  if (!captureFps || Math.abs(captureFps - mediaFps) / mediaFps <= SNAP_TOLERANCE) {
    return `${round(mediaFps)} fps`;
  }
  return `${round(captureFps)} → ${round(mediaFps)} fps`;
}
