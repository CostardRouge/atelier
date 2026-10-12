/**
 * HARMONISING a series on one reference picture: the reference's sections
 * are applied to the others as they are, except the EXPOSURE, which is
 * offset per picture so each lands at the reference's brightness — the drone,
 * the Sony and the phone metered differently, and one number copied across
 * leaves one dark and one burned.
 *
 * The offset is measured on the pictures AS SHOT (`shot-record.ts`, the
 * stats kept beside each record): the median encoded luminance of each,
 * taken to linear light, and the stops between them. A median, never a
 * mean — a sun in frame drags a mean and leaves a median alone. Clamped to
 * ±2 EV: past that the pictures are not of one light and a slider will not
 * make them so; said in the answer.
 *
 * Pure and DOM-free.
 */

import { percentile, type SourceStats } from './auto-develop';
import { DEVELOP_RANGES, type DevelopSettings } from './develop';

/** The widest offset harmonising will apply, in EV. */
export const MATCH_MAX_EV = 2;
/** A display gamma: what the encoded luminance of an 8-bit sample means in light. */
const GAMMA = 2.2;

/** The median luminance of an as-shot sample in LINEAR light, 0..1. */
export function linearMedian(stats: Pick<SourceStats, 'bins' | 'total'>): number {
  return Math.pow(percentile(stats.bins, stats.total, 0.5), GAMMA);
}

/**
 * The stops to add to `target`'s exposure so its median lands on `reference`'s,
 * rounded to 0.05 EV and clamped; `clamped` says when the true gap was wider.
 * Null when either sample is empty or black.
 */
export function exposureOffset(
  reference: Pick<SourceStats, 'bins' | 'total'>,
  target: Pick<SourceStats, 'bins' | 'total'>,
): { ev: number; clamped: boolean } | null {
  const a = linearMedian(reference);
  const b = linearMedian(target);
  if (!(a > 0) || !(b > 0) || reference.total === 0 || target.total === 0) return null;
  const raw = Math.log2(a / b);
  const ev = Math.round(Math.max(-MATCH_MAX_EV, Math.min(MATCH_MAX_EV, raw)) * 20) / 20;
  return { ev, clamped: Math.abs(raw) > MATCH_MAX_EV };
}

/**
 * `develop` with its exposure moved by `ev`, inside the slider's range; a
 * null develop is the default record, so the move lands on 0.
 */
export function withExposureOffset(develop: DevelopSettings | null, ev: number): DevelopSettings | null {
  const { min, max } = DEVELOP_RANGES.exposure;
  const base = develop?.exposure ?? 0;
  const exposure = Math.round(Math.max(min, Math.min(max, base + ev)) * 100) / 100;
  if (!develop) return exposure === 0 ? null : ({ exposure } as DevelopSettings);
  return { ...develop, exposure };
}
