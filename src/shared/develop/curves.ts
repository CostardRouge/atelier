/**
 * TONE SHAPING — levels and curves, the two controls a develop's eleven
 * sliders cannot express.
 *
 * A slider moves the whole picture one way. A curve moves ONE part of the
 * range and leaves the rest: the shoulder without the midtones, the blacks
 * without the shadows, a cast out of the greens alone. It is the control
 * every developer keeps, and it is why this module exists beside the sliders
 * rather than as more of them.
 *
 * Both work on **encoded** values in [0,1] — sRGB codes, where "the
 * three-quarter tone" means what a photographer points at on the histogram.
 * `develop.ts` decodes and re-encodes around them; nothing here sees linear
 * light.
 *
 * FIVE curves, which are Capture One's own and so the maintainer's:
 *
 * - `luma` is applied as ONE RATIO on the pixel's luminance, so a grey stays
 *   grey and no hue rotates — the guarantee every tonal control in
 *   `develop.ts` already keeps.
 * - `rgb` runs all three channels through the same map DIRECTLY. That does
 *   move saturation, and it is what the control is FOR: it is the classic
 *   contrast curve, and a photographer who wants the other behaviour reaches
 *   for `luma`.
 * - `red`, `green`, `blue` are per channel, and tint on purpose.
 *
 * LEVELS are the coarse version of the same idea — a black point, a white
 * point and a midtone gamma — kept apart because setting a black point is one
 * gesture and should not cost three control points. Master (`rgb`) plus the
 * three channels; there is no luma-levels, because the luma curve is it.
 *
 * ORDER, fixed so two documents can never disagree: levels (master, then the
 * channel) → curves (master, then the channel). Luma rides separately, as a
 * ratio, applied by `develop.ts` before any of this.
 *
 * INTERPOLATION is monotone cubic (Fritsch–Carlson). A natural or Catmull-Rom
 * spline overshoots between control points and can run BACKWARDS — on a tone
 * curve that reads as banding and inverted tones, i.e. as a broken tool. The
 * tangent clamp is what forbids it, and it is not an optimisation to remove.
 *
 * Pure and DOM-free.
 */

// --- curves -----------------------------------------------------------------

/** A control point, both coordinates ENCODED and in [0,1]. */
export interface CurvePoint {
  x: number;
  y: number;
}

/** A curve: at least two points, sorted by x, no two sharing an x. */
export type Curve = CurvePoint[];

export type CurveChannel = 'luma' | 'rgb' | 'red' | 'green' | 'blue';

/** The tabs, in the order a panel draws them and the order the maths applies. */
export const CURVE_CHANNELS: readonly CurveChannel[] = ['luma', 'rgb', 'red', 'green', 'blue'];

/** Every channel null — "does nothing". One spelling, so the test is simple. */
export interface ToneCurves {
  luma: Curve | null;
  rgb: Curve | null;
  red: Curve | null;
  green: Curve | null;
  blue: Curve | null;
}

export const DEFAULT_CURVES: Readonly<ToneCurves> = Object.freeze({
  luma: null,
  rgb: null,
  red: null,
  green: null,
  blue: null,
});

/** The straight line, for a panel that wants two draggable ends to start from. */
export function identityCurve(): Curve {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];
}

/**
 * A curve that does nothing. Every point on y = x, which a monotone cubic
 * reproduces as the straight line — so an identity curve is SKIPPED rather
 * than evaluated, and an untouched pixel comes back bit-identical.
 */
export function isIdentityCurve(c: Curve | null | undefined): boolean {
  if (!c || c.length < 2) return true;
  return c.every((p) => p.x === p.y);
}

export function isDefaultCurves(c: ToneCurves | null | undefined): boolean {
  if (!c) return true;
  return CURVE_CHANNELS.every((ch) => isIdentityCurve(c[ch]));
}

/** More than this and a junk file could make every bake crawl. */
export const CURVE_MAX_POINTS = 32;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * A stored curve read back safely: non-finite coordinates dropped, the rest
 * clamped to [0,1] and sorted; two points sharing an x would be a vertical
 * jump no spline can draw, so the later one goes. Fewer than two points, or a
 * curve that does nothing, reads as `null`.
 */
export function normaliseCurve(raw: unknown): Curve | null {
  if (!Array.isArray(raw)) return null;
  const pts: CurvePoint[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
    pts.push({ x: clamp01(e.x), y: clamp01(e.y) });
    if (pts.length >= CURVE_MAX_POINTS) break;
  }
  pts.sort((a, b) => a.x - b.x);
  const out: CurvePoint[] = [];
  for (const p of pts) {
    if (out.length && out[out.length - 1].x === p.x) continue;
    out.push(p);
  }
  if (out.length < 2) return null;
  return isIdentityCurve(out) ? null : out;
}

export function normaliseCurves(raw: unknown): ToneCurves {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    luma: normaliseCurve(src.luma),
    rgb: normaliseCurve(src.rgb),
    red: normaliseCurve(src.red),
    green: normaliseCurve(src.green),
    blue: normaliseCurve(src.blue),
  };
}

/** As a document holds it: `null` when nothing shapes, the "empty means computed" rule. */
export function curvesOrNull(raw: unknown): ToneCurves | null {
  if (raw === null || raw === undefined) return null;
  const c = normaliseCurves(raw);
  return isDefaultCurves(c) ? null : c;
}

export function cloneCurves(c: ToneCurves | null | undefined): ToneCurves | null {
  if (!c) return null;
  const out = {} as ToneCurves;
  for (const ch of CURVE_CHANNELS) {
    const curve = c[ch];
    out[ch] = curve ? curve.map((p) => ({ x: p.x, y: p.y })) : null;
  }
  return out;
}

export function sameCurve(a: Curve | null | undefined, b: Curve | null | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (isIdentityCurve(a) && isIdentityCurve(b)) return true;
  if (x.length !== y.length) return false;
  return x.every((p, i) => p.x === y[i].x && p.y === y[i].y);
}

export function sameCurves(a: ToneCurves | null | undefined, b: ToneCurves | null | undefined): boolean {
  return CURVE_CHANNELS.every((ch) => sameCurve(a?.[ch], b?.[ch]));
}

/**
 * The curve as one function, RESOLVED ONCE — the `makeTransfer` rule: the bake
 * calls the result tens of thousands of times and must not re-derive the
 * tangents per point.
 *
 * Fritsch–Carlson monotone cubic Hermite. Outside the first and last x the
 * value is held at that end's y: a curve is defined on the range its points
 * span, and extending it would invent a shape nobody drew.
 */
export function makeCurve(points: Curve): (v: number) => number {
  const n = points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    xs[i] = points[i].x;
    ys[i] = points[i].y;
  }
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    const h = xs[i + 1] - xs[i];
    d[i] = h > 0 ? (ys[i + 1] - ys[i]) / h : 0;
  }
  const m = new Float64Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = (d[i - 1] + d[i]) / 2;
  // The clamp that makes it monotone: without it a cubic overshoots between
  // points and can turn back on itself, which on a tone curve is banding and
  // inverted tones. Do not remove it as "smoothing".
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  return (v: number) => {
    if (v <= xs[0]) return ys[0];
    if (v >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (v < xs[mid]) hi = mid;
      else lo = mid;
    }
    const h = xs[lo + 1] - xs[lo];
    const t = (v - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h * m[lo] +
      (-2 * t3 + 3 * t2) * ys[lo + 1] +
      (t3 - t2) * h * m[lo + 1];
    return clamp01(y);
  };
}

// --- levels -----------------------------------------------------------------

/**
 * One channel of levels. Input black and white are where the range is read
 * FROM, output black and white where it is written TO, and `gamma` bends the
 * midtones between them — 1 is neutral, above 1 lifts (Photoshop's own
 * convention, so a number carried from elsewhere means what it looks like).
 */
export interface LevelChannel {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export type LevelsChannel = 'rgb' | 'red' | 'green' | 'blue';

export const LEVELS_CHANNELS: readonly LevelsChannel[] = ['rgb', 'red', 'green', 'blue'];

export interface Levels {
  rgb: LevelChannel | null;
  red: LevelChannel | null;
  green: LevelChannel | null;
  blue: LevelChannel | null;
}

export const NEUTRAL_LEVEL: Readonly<LevelChannel> = Object.freeze({
  inBlack: 0,
  inWhite: 1,
  gamma: 1,
  outBlack: 0,
  outWhite: 1,
});

export const DEFAULT_LEVELS: Readonly<Levels> = Object.freeze({
  rgb: null,
  red: null,
  green: null,
  blue: null,
});

export const MIN_LEVEL_GAMMA = 0.1;
export const MAX_LEVEL_GAMMA = 10;

export function isNeutralLevel(l: LevelChannel | null | undefined): boolean {
  if (!l) return true;
  return (
    l.inBlack === 0 && l.inWhite === 1 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 1
  );
}

export function isDefaultLevels(l: Levels | null | undefined): boolean {
  if (!l) return true;
  return LEVELS_CHANNELS.every((ch) => isNeutralLevel(l[ch]));
}

/**
 * A stored level read back safely. An input range that is empty or inverted is
 * not a level, it is a threshold nobody asked for, so the whole channel comes
 * back neutral rather than as a black-and-white picture. The test is for a
 * POSITIVE span and nothing more: a narrower bound rejected a legitimate
 * one-code range, because `0.5 + 1/255` minus `0.5` is a hair under `1/255`.
 * Any positive span divides safely — a steep slope is clamped, never infinite.
 */
export function normaliseLevel(raw: unknown): LevelChannel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const inBlack = clamp01(num(r.inBlack, 0));
  const inWhite = clamp01(num(r.inWhite, 1));
  if (!(inWhite - inBlack > 0)) return null;
  const g = num(r.gamma, 1);
  const level: LevelChannel = {
    inBlack,
    inWhite,
    gamma: g < MIN_LEVEL_GAMMA ? MIN_LEVEL_GAMMA : g > MAX_LEVEL_GAMMA ? MAX_LEVEL_GAMMA : g,
    outBlack: clamp01(num(r.outBlack, 0)),
    outWhite: clamp01(num(r.outWhite, 1)),
  };
  return isNeutralLevel(level) ? null : level;
}

export function normaliseLevels(raw: unknown): Levels {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    rgb: normaliseLevel(src.rgb),
    red: normaliseLevel(src.red),
    green: normaliseLevel(src.green),
    blue: normaliseLevel(src.blue),
  };
}

export function levelsOrNull(raw: unknown): Levels | null {
  if (raw === null || raw === undefined) return null;
  const l = normaliseLevels(raw);
  return isDefaultLevels(l) ? null : l;
}

export function cloneLevels(l: Levels | null | undefined): Levels | null {
  if (!l) return null;
  const out = {} as Levels;
  for (const ch of LEVELS_CHANNELS) {
    const c = l[ch];
    out[ch] = c ? { ...c } : null;
  }
  return out;
}

export function sameLevel(a: LevelChannel | null | undefined, b: LevelChannel | null | undefined): boolean {
  if (isNeutralLevel(a) && isNeutralLevel(b)) return true;
  if (!a || !b) return false;
  return (
    a.inBlack === b.inBlack &&
    a.inWhite === b.inWhite &&
    a.gamma === b.gamma &&
    a.outBlack === b.outBlack &&
    a.outWhite === b.outWhite
  );
}

export function sameLevels(a: Levels | null | undefined, b: Levels | null | undefined): boolean {
  return LEVELS_CHANNELS.every((ch) => sameLevel(a?.[ch], b?.[ch]));
}

/** One channel of levels as a function, resolved once. */
export function makeLevel(l: LevelChannel): (v: number) => number {
  const span = l.inWhite - l.inBlack;
  const outSpan = l.outWhite - l.outBlack;
  const invGamma = 1 / l.gamma;
  return (v: number) => {
    let t = (v - l.inBlack) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (invGamma !== 1) t = Math.pow(t, invGamma);
    return clamp01(l.outBlack + outSpan * t);
  };
}

// --- the stage --------------------------------------------------------------

/** A per-channel map of ENCODED values; `channel` is 0 = red, 1 = green, 2 = blue. */
export type ChannelShaper = (value: number, channel: 0 | 1 | 2) => number;

/**
 * The luma curve as one map of encoded LUMINANCE, or null when it does not
 * shape. `develop.ts` applies the result as a ratio, so a grey stays grey.
 */
export function makeLumaShaper(curves: ToneCurves | null | undefined): ((L: number) => number) | null {
  const c = curves?.luma;
  return isIdentityCurve(c) ? null : makeCurve(c as Curve);
}

/**
 * Levels and the rgb / red / green / blue curves as ONE per-channel map, or
 * null when none of them shapes. Resolved once; the order inside a channel is
 * levels master → levels channel → curve master → curve channel, and it is
 * fixed.
 */
export function makeChannelShaper(
  curves: ToneCurves | null | undefined,
  levels: Levels | null | undefined,
): ChannelShaper | null {
  const c = curves ?? DEFAULT_CURVES;
  const l = levels ?? DEFAULT_LEVELS;

  const masterLevel = isNeutralLevel(l.rgb) ? null : makeLevel(l.rgb as LevelChannel);
  const masterCurve = isIdentityCurve(c.rgb) ? null : makeCurve(c.rgb as Curve);
  const chLevels = [l.red, l.green, l.blue];
  const chCurves = [c.red, c.green, c.blue];

  const chains: ((v: number) => number)[][] = [];
  let shapes = false;
  for (let i = 0; i < 3; i += 1) {
    const chain: ((v: number) => number)[] = [];
    if (masterLevel) chain.push(masterLevel);
    if (!isNeutralLevel(chLevels[i])) chain.push(makeLevel(chLevels[i] as LevelChannel));
    if (masterCurve) chain.push(masterCurve);
    if (!isIdentityCurve(chCurves[i])) chain.push(makeCurve(chCurves[i] as Curve));
    if (chain.length) shapes = true;
    chains.push(chain);
  }
  if (!shapes) return null;

  return (value: number, channel: 0 | 1 | 2) => {
    const chain = chains[channel];
    let v = value;
    for (let i = 0; i < chain.length; i += 1) v = chain[i](v);
    return v;
  };
}

// --- words ------------------------------------------------------------------

/** `curve luma+red`, or an empty string when nothing shapes. */
export function describeCurves(c: ToneCurves | null | undefined): string {
  if (isDefaultCurves(c)) return '';
  const on = CURVE_CHANNELS.filter((ch) => !isIdentityCurve(c?.[ch]));
  return `curve ${on.join('+')}`;
}

/** `levels rgb+blue`, or an empty string when nothing shapes. */
export function describeLevels(l: Levels | null | undefined): string {
  if (isDefaultLevels(l)) return '';
  const on = LEVELS_CHANNELS.filter((ch) => !isNeutralLevel(l?.[ch]));
  return `levels ${on.join('+')}`;
}
