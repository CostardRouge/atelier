/**
 * The TECHNICAL MISSES of a listing — blurred, too dark, too bright, clipped,
 * crushed — each said with the measure behind it, as a PROPOSAL: a night
 * frame is dark on purpose, and only the person knows. Nothing is rejected
 * here; culling is Winnow's.
 *
 * Blur is RELATIVE to the batch: a frame far under the batch's median
 * sharpness (and under an absolute floor) is flagged, which is what tells a
 * missed focus from a soft style shared by the whole day. With fewer than
 * `MIN_FOR_MEDIAN` measured frames only the floor speaks.
 *
 * Pure and DOM-free.
 */

import type { ThumbMetrics } from '../../media/thumb-metrics';

export interface MissItem {
  id: number;
  metrics: ThumbMetrics | null;
}

export type MissKind = 'blur' | 'dark' | 'bright' | 'clipped' | 'crushed';

export interface MissFlag {
  kind: MissKind;
  /** The number behind the flag, for the agent to weigh: "sharpness 0.0003 (batch median 0.004)". */
  measure: string;
}

export interface Miss {
  id: number;
  flags: MissFlag[];
}

export interface MissOptions {
  /** Sharpness under this is blur whatever the batch. */
  blurFloor?: number;
  /** Sharpness under this share of the batch's median is blur. */
  blurShare?: number;
  darkMeanBelow?: number;
  darkP99Below?: number;
  brightMeanAbove?: number;
  clippedAbove?: number;
  crushedAbove?: number;
}

export const MISS_DEFAULTS: Required<MissOptions> = {
  blurFloor: 0.0005,
  blurShare: 0.3,
  darkMeanBelow: 40,
  darkP99Below: 110,
  brightMeanAbove: 215,
  clippedAbove: 0.08,
  crushedAbove: 0.12,
};

export const MIN_FOR_MEDIAN = 4;

export function findMisses(items: readonly MissItem[], opts: MissOptions = {}): { misses: Miss[]; medianSharpness: number | null } {
  const o = { ...MISS_DEFAULTS, ...opts };
  const sharp = items.map((i) => i.metrics?.sharpness).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
  const median = sharp.length >= MIN_FOR_MEDIAN ? sharp[Math.floor(sharp.length / 2)] : null;
  const blurBelow = median === null ? o.blurFloor : Math.max(o.blurFloor, median * o.blurShare);
  const misses: Miss[] = [];
  for (const item of items) {
    const m = item.metrics;
    if (!m) continue;
    const flags: MissFlag[] = [];
    const e = m.exposure;
    if (m.sharpness < blurBelow) {
      flags.push({ kind: 'blur', measure: `sharpness ${m.sharpness}${median !== null ? ` (batch median ${median})` : ''}` });
    }
    if (e.mean < o.darkMeanBelow || e.p99 < o.darkP99Below) flags.push({ kind: 'dark', measure: `mean ${e.mean}, p99 ${e.p99}` });
    if (e.mean > o.brightMeanAbove) flags.push({ kind: 'bright', measure: `mean ${e.mean}` });
    if (e.clippedHighlights > o.clippedAbove) flags.push({ kind: 'clipped', measure: `${Math.round(e.clippedHighlights * 1000) / 10} % at white` });
    if (e.crushedShadows > o.crushedAbove) flags.push({ kind: 'crushed', measure: `${Math.round(e.crushedShadows * 1000) / 10} % at black` });
    if (flags.length) misses.push({ id: item.id, flags });
  }
  return { misses, medianSharpness: median };
}
