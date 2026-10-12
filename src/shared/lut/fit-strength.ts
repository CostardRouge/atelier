/**
 * FINDING how strongly a look may land — by measuring, not by taste
 * (`develop.fitLook`, the maintainer's ask: an agent that *tâtonne* to the
 * value that avoids saturation). The picture is measured with the look OFF,
 * then at rising strengths; a strength passes while the look's colour stays
 * within limits RELATIVE to that baseline — the mean chroma, the vivid share,
 * colour against the gamut's wall, and clipping at either end — and the
 * answer is the strongest that passes, never past `ceiling` (a look is almost
 * never right at 100 %, `look-strength.ts`).
 *
 * A coarse ladder first (every `COARSE`), then halving between the last pass
 * and the first failure down to `FINE`: eight or so measures, each a render
 * of the real stage. Saturation rises with strength (measured, `develop.md`),
 * which is what makes the search sound; a picture where it does not still
 * gets an honest answer, the last strength that passed.
 *
 * Pure: the measuring is handed in.
 */

import type { HistogramReading } from '../develop/histogram';

export interface FitLimits {
  /** The strongest it may answer, whatever the measures say. */
  ceiling: number;
  /** How much the mean chroma may grow, as a share of the look-off picture's (0.25 = a quarter more). */
  meanGain: number;
  /** How much the vivid share may grow, absolute (0.08 = eight points of the picture). */
  vividGain: number;
  /** How much colour against the gamut's wall may grow, absolute. */
  edgeGain: number;
  /** How much clipping (white plus black) may grow, absolute. */
  clipGain: number;
}

export const DEFAULT_FIT: FitLimits = { ceiling: 0.8, meanGain: 0.25, vividGain: 0.08, edgeGain: 0.01, clipGain: 0.01 };

/** The ladder's first rungs, then the finest difference the answer tells. */
const COARSE = 0.2;
const FINE = 0.05;
/** However grey the picture, a look may add this much mean chroma: a quarter of almost nothing is nothing. */
const MEAN_FLOOR = 0.03;

export interface FitStep {
  strength: number;
  mean: number;
  vivid: number;
  gamutEdge: number;
  clipped: number;
  ok: boolean;
  /** What went past its limit, in words. */
  over: string[];
}

export interface FitResult {
  /** The strongest strength that passed — 0 when even the faintest did not. */
  strength: number;
  /** The picture with the look off. */
  base: { mean: number; vivid: number; gamutEdge: number; clipped: number };
  /** Every strength measured, in the order it was. */
  steps: FitStep[];
  /** Why it stopped where it did, in words. */
  reason: string;
}

const round = (v: number, step = FINE) => Math.round(v / step) * step;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** A limit said to the thousandth, as the measures are: "0.34 > 0.34" says nothing. */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function judge(strength: number, base: FitResult['base'], m: HistogramReading, limits: FitLimits): FitStep {
  const clipped = m.clippedHighlights + m.crushedShadows;
  const over: string[] = [];
  const meanCap = Math.max(base.mean * (1 + limits.meanGain), base.mean + MEAN_FLOOR);
  if (m.saturation.mean > meanCap) over.push(`mean chroma ${m.saturation.mean} > ${r3(meanCap)}`);
  if (m.saturation.vivid > base.vivid + limits.vividGain) over.push(`vivid ${m.saturation.vivid} > ${r3(base.vivid + limits.vividGain)}`);
  if (m.saturation.gamutEdge > base.gamutEdge + limits.edgeGain) over.push(`gamut edge ${m.saturation.gamutEdge} > ${r3(base.gamutEdge + limits.edgeGain)}`);
  if (clipped > base.clipped + limits.clipGain) over.push(`clipped ${r3(clipped)} > ${r3(base.clipped + limits.clipGain)}`);
  return { strength: r2(strength), mean: m.saturation.mean, vivid: m.saturation.vivid, gamutEdge: m.saturation.gamutEdge, clipped: r2(clipped), ok: over.length === 0, over };
}

/** The strongest strength whose measures stay within the limits, and every measure taken. */
export async function fitStrength(measureAt: (strength: number) => Promise<HistogramReading>, limits: FitLimits = DEFAULT_FIT): Promise<FitResult> {
  const ceiling = Math.max(FINE, round(limits.ceiling));
  const off = await measureAt(0);
  const base = {
    mean: off.saturation.mean,
    vivid: off.saturation.vivid,
    gamutEdge: off.saturation.gamutEdge,
    clipped: r2(off.clippedHighlights + off.crushedShadows),
  };
  const steps: FitStep[] = [];
  const at = async (s: number) => {
    const step = judge(s, base, await measureAt(s), limits);
    steps.push(step);
    return step;
  };

  // The ladder: up by COARSE until a strength fails or the ceiling is reached.
  let lo = 0;
  let hi: number | null = null;
  for (let s = COARSE; s <= ceiling + 1e-9; s = round(s + COARSE)) {
    if ((await at(s)).ok) lo = s;
    else {
      hi = s;
      break;
    }
  }
  if (hi === null && lo < ceiling) {
    if ((await at(ceiling)).ok) lo = ceiling;
    else hi = ceiling;
  }
  if (hi === null) return { strength: r2(lo), base, steps, reason: `every measure stayed within the limits up to the ceiling, ${Math.round(ceiling * 100)} %` };

  // Halving between the last pass and the first failure.
  while (hi - lo > FINE + 1e-9) {
    const mid = round((lo + hi) / 2);
    if (mid <= lo + 1e-9 || mid >= hi - 1e-9) break;
    if ((await at(mid)).ok) lo = mid;
    else hi = mid;
  }
  const failed = steps.find((s) => Math.abs(s.strength - r2(hi!)) < 1e-9);
  const why = failed?.over.join(', ') ?? 'a limit';
  return {
    strength: r2(lo),
    base,
    steps,
    reason: lo > 0 ? `${Math.round(hi * 100)} % went past it (${why})` : `even ${Math.round(hi * 100)} % went past it (${why}) — this look is too strong for this picture`,
  };
}
