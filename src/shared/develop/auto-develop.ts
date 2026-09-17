/**
 * AUTO — what the picture itself says its correction should be.
 *
 * Two verbs, kept apart on purpose, because they answer different questions
 * and one of them is often wrong:
 *
 * - **Auto tone** stretches the range: a black point, a white point and a
 *   midtone gamma, written as `levels.rgb`. Almost always an improvement on a
 *   flat capture, and it touches no colour.
 * - **Auto colour** neutralises the cast: temperature and tint, by grey-world.
 *   On a sunset, a candle-lit room or anything warm ON PURPOSE it is exactly
 *   the wrong answer, which is why it is a second button and never rides along
 *   with the first.
 *
 * Both are measured on the picture **as shot**, never on what is currently
 * displayed, so pressing Auto twice gives the same answer instead of
 * compounding — it SETS the numbers, it does not nudge them.
 *
 * Everything here is written against this suite's own develop model: the
 * gammas and gains are solved for `makeLevel` and for `developLinear`'s two
 * white-balance reaches, so what Auto writes lands exactly where it aimed.
 * Pure and DOM-free.
 */

import { toLinear } from '../lut/transfer';
import { TEMPERATURE_REACH, TINT_REACH } from './develop';
import { HISTOGRAM_BINS } from './histogram';
import { MAX_LEVEL_GAMMA, MIN_LEVEL_GAMMA, type Levels } from './curves';

/** What a picture is, measured once from a small AS-SHOT sample. */
export interface SourceStats {
  /** Encoded-luminance bins, dark to light. */
  bins: number[];
  /** Pixels read. */
  total: number;
  /**
   * Mean of each channel in LINEAR light, over pixels clipped at neither end.
   * Clipped pixels carry no colour information — a blown sky is (1,1,1)
   * whatever it really was — and letting them vote drags every white balance
   * toward neutral.
   */
  linearMean: [number, number, number];
  /** Pixels that voted for `linearMean`; 0 means there is nothing to balance. */
  counted: number;
}

const WHITE = 254;
const BLACK = 1;

/** The share of pixels allowed to clip at each end when a black/white point is set. */
export const TONE_CLIP = 0.0025;
/** Where the median is aimed, and how far it is actually pulled there. */
const MID_TARGET = 0.5;
const MID_PULL = 0.6;
/** Narrower than this and there is no range to stretch — a flat grey card, a blank frame. */
const MIN_TONE_SPAN = 0.02;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Measure RGBA bytes (a canvas's `ImageData.data`) of the picture AS SHOT.
 * The same sample size and the same Rec.709 weighting as the histogram, so the
 * two instruments agree about where the light is.
 */
export function measureSource(rgba: ArrayLike<number>, binCount = HISTOGRAM_BINS): SourceStats {
  const count = Math.max(1, Math.floor(binCount));
  const bins = new Array<number>(count).fill(0);
  const pixels = Math.floor(rgba.length / 4);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let counted = 0;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    const r = rgba[o];
    const g = rgba[o + 1];
    const b = rgba[o + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    bins[Math.min(count - 1, Math.max(0, Math.floor((y * count) / 256)))] += 1;
    const clipped = r >= WHITE || g >= WHITE || b >= WHITE;
    const crushed = r <= BLACK && g <= BLACK && b <= BLACK;
    if (!clipped && !crushed) {
      sr += toLinear(r / 255, 'srgb');
      sg += toLinear(g / 255, 'srgb');
      sb += toLinear(b / 255, 'srgb');
      counted += 1;
    }
  }
  return {
    bins,
    total: pixels,
    linearMean: counted ? [sr / counted, sg / counted, sb / counted] : [0, 0, 0],
    counted,
  };
}

/**
 * The encoded value (0..1) below which share `p` of the pixels sit. Interpolated
 * INSIDE the bin it lands in: at 64 bins a whole bin is four 8-bit codes, and a
 * black point that can only be a multiple of four is a visibly coarse one.
 */
export function percentile(bins: readonly number[], total: number, p: number): number {
  if (total <= 0 || bins.length === 0) return clamp(p, 0, 1);
  const want = total * clamp(p, 0, 1);
  let below = 0;
  for (let i = 0; i < bins.length; i += 1) {
    const n = bins[i];
    if (below + n >= want) {
      const within = n > 0 ? (want - below) / n : 0;
      return clamp((i + within) / bins.length, 0, 1);
    }
    below += n;
  }
  return 1;
}

/**
 * Levels that stretch the picture's own range to the full one and put its
 * median near the middle — or null when there is nothing to stretch.
 *
 * The gamma is SOLVED for `makeLevel`, which raises the mapped value to
 * `1/gamma`: aiming the median at `target` means `gamma = ln(m) / ln(target)`.
 * The median is pulled only part of the way to mid-grey, so a picture that is
 * dark or bright because it was MEANT to be keeps its character.
 */
export function autoTone(stats: SourceStats): Levels | null {
  const lo = percentile(stats.bins, stats.total, TONE_CLIP);
  const hi = percentile(stats.bins, stats.total, 1 - TONE_CLIP);
  if (hi - lo < MIN_TONE_SPAN) return null;

  const median = percentile(stats.bins, stats.total, 0.5);
  const mapped = (median - lo) / (hi - lo);
  let gamma = 1;
  // Only a median strictly inside the range has a gamma that means anything:
  // at 0 or 1 the solve is a division by zero or a demand no curve can meet.
  if (mapped > 0.001 && mapped < 0.999) {
    const target = mapped + (MID_TARGET - mapped) * MID_PULL;
    if (target > 0.001 && target < 0.999) {
      gamma = clamp(Math.log(mapped) / Math.log(target), MIN_LEVEL_GAMMA, MAX_LEVEL_GAMMA);
    }
  }

  const level = { inBlack: lo, inWhite: hi, gamma, outBlack: 0, outWhite: 1 };
  // Already using its whole range with a centred median: say so by changing
  // nothing, rather than writing a level that does nothing.
  if (lo === 0 && hi === 1 && gamma === 1) return null;
  return { rgb: level, red: null, green: null, blue: null };
}

/**
 * Temperature and tint that make the average of the picture neutral —
 * grey-world, solved against this suite's own two gains rather than against a
 * colour temperature nobody here can measure.
 *
 * `developLinear` multiplies red by `1 + t` and blue by `1 - t`, so balancing
 * them wants `t = (mB - mR) / (mB + mR)`; green is then brought to the level
 * the other two met at. Both are expressed back in slider units and clamped,
 * so a violently cast picture asks for what it can have and says no more.
 */
export function autoColour(stats: SourceStats): AutoColour {
  const [mr, mg, mb] = stats.linearMean;
  if (!stats.counted || mr <= 0 || mg <= 0 || mb <= 0) {
    return { temperature: 0, tint: 0, clamped: false };
  }
  const t = (mb - mr) / (mb + mr);
  // Rounded HERE, before green is solved: a slider holds whole units, and
  // solving the tint against a temperature finer than the one actually stored
  // aims green at a level red and blue never reach.
  const temperature = Math.round(clamp((t / TEMPERATURE_REACH) * 100, -100, 100));
  // Where red and blue really land — which is short of neutral when the cast
  // is beyond the slider's own reach, and the tint must aim at that, not at
  // the neutral it could not get to.
  const applied = (temperature / 100) * TEMPERATURE_REACH;
  const balanced = mr * (1 + applied);
  const u = 1 - balanced / mg;
  const tint = Math.round(clamp((u / TINT_REACH) * 100, -100, 100));
  // Said out loud rather than quietly delivered: a cast this strong cannot be
  // neutralised by two gains with a range, so the picture stays cast and the
  // panel must not imply it is balanced. The battery gauge's rule.
  const wanted = (t / TEMPERATURE_REACH) * 100;
  return { temperature, tint, clamped: Math.abs(wanted) > 100.5 };
}

/** What Auto colour found. `clamped` means the cast is past the sliders' reach. */
export interface AutoColour {
  temperature: number;
  tint: number;
  clamped: boolean;
}

/** What Auto tone did, for the line that reports it — or why it did nothing. */
export function describeAutoTone(levels: Levels | null): string {
  if (!levels?.rgb) return 'nothing to stretch';
  const { inBlack, inWhite, gamma } = levels.rgb;
  const parts = [`black ${Math.round(inBlack * 255)}`, `white ${Math.round(inWhite * 255)}`];
  if (gamma !== 1) parts.push(`gamma ${gamma.toFixed(2)}`);
  return parts.join(' · ');
}
