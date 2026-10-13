/**
 * A model of the author's OWN — the develop predictor `training/` learns from
 * his rolls (M6 of `training/PLAN.md`, B4 of `docs/auto-develop.md` §6):
 * the picture as shot in, the eleven sliders of `DevelopSettings` out.
 *
 * What crosses between the two sides is a FORMAT, fixed here and in
 * `training/src/atelier_training/records.py` alike — a change is a version
 * bump on both:
 *
 * - the SIDECAR `develop-net.json` the trainer writes beside the ONNX file
 *   (`readOwnModelSidecar`): the thumbnail size, the slider order and ranges;
 * - the STATS vector: the as-shot histogram resampled onto `STATS_BINS`
 *   fractions through its cumulative sum, then the three linear means
 *   (`statsVector` — bit for bit `records.stats_vector`);
 * - the EXIF vector: five camera facts on log scales (`exifVector`).
 *
 * The answer is CLAMPED to each slider's own range and rounded to its step
 * (`slidersFromOutput`), so what the model writes is always a record a
 * panel could have written. Pure and DOM-free; the vault is
 * `own-model-vault.ts`, the run `own-model-run.ts`.
 */

import type { SourceStats } from './auto-develop';
import { DEVELOP_KEYS, DEVELOP_RANGES, type DevelopKey, type DevelopSettings } from './develop';
import type { ShotExif } from './shot-record';

/** The sidecar's `kind`, as `train_develop.py` writes it. */
export const OWN_MODEL_KIND = 'atelier/develop-net';
/** How many fractions the histogram is resampled to — `STATS_BINS` in `records.py`. */
export const STATS_BINS = 64;
/** The stats vector's length: the bins plus the three linear means. */
export const STATS_DIM = STATS_BINS + 3;
/** The camera facts, in the order the model reads them — `EXIF_KEYS` in `records.py`. */
export const EXIF_KEYS = ['iso', 'exposureTime', 'fNumber', 'focalLength35', 'exposureBias'] as const;

/** The eleven sliders alone — what the model answers. */
export type DevelopSliders = Pick<DevelopSettings, DevelopKey>;

/** `develop-net.json`, read. */
export interface OwnModelSidecar {
  /** The run folder's name — `20261013-091200-develop-mine`. */
  run: string;
  /** The square thumbnail the model reads, in pixels. */
  thumb: number;
  /** The output's order: every entry a slider of `DevelopSettings`. */
  sliders: DevelopKey[];
  /** The output's reach per slider, in the model's own units. */
  ranges: number[];
}

const KEY_SET: ReadonlySet<string> = new Set(DEVELOP_KEYS);

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** The sidecar read back safely; null, with no guess, where a field is not what the trainer writes. */
export function readOwnModelSidecar(raw: unknown): OwnModelSidecar | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== OWN_MODEL_KIND || r.version !== 1) return null;
  const thumb = r.thumb;
  if (!finite(thumb) || thumb < 8 || thumb > 1024 || Math.round(thumb) !== thumb) return null;
  const output = r.output as { sliders?: unknown; ranges?: unknown } | undefined;
  if (!output || !Array.isArray(output.sliders) || !Array.isArray(output.ranges)) return null;
  if (output.sliders.length === 0 || output.sliders.length !== output.ranges.length) return null;
  const sliders: DevelopKey[] = [];
  for (const s of output.sliders) {
    if (typeof s !== 'string' || !KEY_SET.has(s) || sliders.includes(s as DevelopKey)) return null;
    sliders.push(s as DevelopKey);
  }
  const ranges = output.ranges.map((v) => (finite(v) && v > 0 ? v : NaN));
  if (ranges.some((v) => Number.isNaN(v))) return null;
  return { run: typeof r.run === 'string' ? r.run : '', thumb, sliders, ranges };
}

/**
 * The histogram as `STATS_BINS` fractions plus the three linear means — the
 * cumulative histogram interpolated linearly at the new edges, exactly as
 * numpy does it in `records.stats_vector`. Zeros where there are no stats.
 */
export function statsVector(stats: SourceStats | null | undefined): Float32Array {
  const out = new Float32Array(STATS_DIM);
  if (!stats || !stats.bins.length) return out;
  const n = stats.bins.length;
  let total = 0;
  for (const b of stats.bins) total += b;
  if (!total) total = 1;
  // The cumulative sum, n + 1 points from 0 to 1.
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) cum[i + 1] = cum[i] + stats.bins[i] / total;
  const at = (x: number): number => {
    // `np.interp` over the integer grid 0..n.
    if (x <= 0) return cum[0];
    if (x >= n) return cum[n];
    const i = Math.floor(x);
    const t = x - i;
    return cum[i] + (cum[i + 1] - cum[i]) * t;
  };
  let prev = at(0);
  for (let k = 1; k <= STATS_BINS; k += 1) {
    const edge = (k * n) / STATS_BINS;
    const next = at(edge);
    out[k - 1] = next - prev;
    prev = next;
  }
  out[STATS_BINS] = stats.linearMean[0] ?? 0;
  out[STATS_BINS + 1] = stats.linearMean[1] ?? 0;
  out[STATS_BINS + 2] = stats.linearMean[2] ?? 0;
  return out;
}

/** Five camera facts on a log scale a network can read; 0 where unknown — `records.exif_vector`. */
export function exifVector(exif: ShotExif | null | undefined): Float32Array {
  const out = new Float32Array(EXIF_KEYS.length);
  if (!exif) return out;
  const iso = exif.iso ?? 0;
  const t = exif.exposureTime ?? 0;
  const f = exif.fNumber ?? 0;
  const fl = exif.focalLength35 || exif.focalLength || 0;
  out[0] = iso > 0 ? Math.log2(iso / 100) : 0;
  out[1] = t > 0 ? Math.log2(t) : 0;
  out[2] = f > 0 ? Math.log2(f) : 0;
  out[3] = fl > 0 ? Math.log2(fl / 35) : 0;
  out[4] = finite(exif.exposureBias) ? exif.exposureBias : 0;
  return out;
}

/** The eleven sliders of a develop, copied. */
export function slidersOf(develop: DevelopSettings): DevelopSliders {
  const out = {} as DevelopSliders;
  for (const k of DEVELOP_KEYS) out[k] = develop[k];
  return out;
}

/** Whether two slider records say the same thing. */
export function sameSliders(a: DevelopSliders, b: DevelopSliders): boolean {
  return DEVELOP_KEYS.every((k) => a[k] === b[k]);
}

/**
 * The model's output as a slider record: each number clamped to its slider's
 * reach and rounded to its step; a slider the model does not answer stays
 * what it was.
 */
export function slidersFromOutput(output: ArrayLike<number>, sidecar: OwnModelSidecar, now: DevelopSliders): DevelopSliders {
  const out = { ...now };
  sidecar.sliders.forEach((key, i) => {
    const v = output[i];
    if (!finite(v)) return;
    const range = DEVELOP_RANGES[key];
    const clamped = Math.min(range.max, Math.max(range.min, v));
    const stepped = Math.round(clamped / range.step) * range.step;
    // `0.1 + 0.2`: the step's own decimals, no more.
    const decimals = Math.max(0, -Math.floor(Math.log10(range.step)));
    out[key] = Number(stepped.toFixed(decimals));
  });
  return out;
}

const SHORT: Readonly<Record<DevelopKey, string>> = {
  exposure: 'exposure',
  brightness: 'brightness',
  contrast: 'contrast',
  highlights: 'highlights',
  shadows: 'shadows',
  whites: 'whites',
  blacks: 'blacks',
  temperature: 'temperature',
  tint: 'tint',
  saturation: 'saturation',
  vibrance: 'vibrance',
};

/**
 * `exposure +0.35 · contrast +12 · shadows +20` — the sliders the answer
 * moved, largest first by reach, at most four named and the rest counted;
 * `nothing to change` when every one stays.
 */
export function describeOwnAnswer(before: DevelopSliders, after: DevelopSliders): string {
  const moved = DEVELOP_KEYS.filter((k) => after[k] !== before[k]);
  if (moved.length === 0) return 'nothing to change';
  const weight = (k: DevelopKey) => Math.abs(after[k] - before[k]) / (DEVELOP_RANGES[k].max - DEVELOP_RANGES[k].min);
  moved.sort((a, b) => weight(b) - weight(a));
  const named = moved.slice(0, 4).map((k) => {
    const v = after[k];
    const text = k === 'exposure' ? v.toFixed(2) : String(Math.round(v));
    return `${SHORT[k]} ${v > 0 ? '+' : ''}${text}`;
  });
  const rest = moved.length - named.length;
  return named.join(' · ') + (rest > 0 ? ` · ${rest} more` : '');
}
