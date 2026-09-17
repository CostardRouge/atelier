/**
 * A DEVELOP: the correction of one picture, as numbers — exposure, brightness,
 * contrast, the four tone bands, white balance, saturation and vibrance.
 *
 * It is a different thing from a GRADE (a look, a `.cube`, per trip or per
 * project) and from an EDIT (overlays, framing, export): a develop belongs to
 * ONE photograph and is never inherited by the next. The design and the
 * reasons are in `docs/photo-develop.md`; the rule that shapes this module is
 * §4's: the same numbers are applied by two APPLIERS and stored once.
 *
 * - `developLinear` is the maths, in linear light, unclamped above 1 so a RAW
 *   developer can hand it headroom and get its highlights back.
 * - `developStage` wraps it for the LUT bake: sRGB code in, sRGB code out,
 *   clamped — the FIRST stage of `composeLutStack`, before every look and
 *   before the output transform (correction → look → delivery, always).
 *
 * Every luminance move (tone bands, contrast, brightness) is applied as ONE
 * ratio on the pixel's luminance, so hue never rotates and a grey stays grey
 * under every slider but the two white-balance ones — the same guarantee the
 * tetrahedral lookup gives one stage later. The tone bands live in the
 * display-referred domain (sRGB-encoded luminance), where "highlights" and
 * "shadows" mean what a photographer expects them to mean.
 *
 * Pure and DOM-free.
 */

import { fromLinear, toLinear } from '../lut/transfer';
import {
  cloneCurves,
  cloneLevels,
  curvesOrNull,
  describeCurves,
  describeLevels,
  isDefaultCurves,
  isDefaultLevels,
  levelsOrNull,
  makeChannelShaper,
  makeLumaShaper,
  normaliseCurves,
  normaliseLevels,
  sameCurves,
  sameLevels,
  type ChannelShaper,
  type Levels,
  type ToneCurves,
} from './curves';

export interface DevelopSettings {
  /** Stops, −3..+3. A linear gain in scene light. */
  exposure: number;
  /**
   * −100..100. A midtone lift (a gamma on luminance), NOT a gain — the
   * maintainer's "luminosité", kept apart from exposure the way Capture One
   * keeps them apart: black and white stay where they are.
   */
  brightness: number;
  /** −100..100. A straight-line stretch of luminance pivoting on 18 % grey. */
  contrast: number;
  /** −100..100 each: four bands of the tone curve, weighted by luminance. */
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  /**
   * −100..100. Warm/cool and green/magenta, as channel gains in linear light.
   * On a RAW the developer maps them onto its own white balance; on an 8-bit
   * picture they are what they are, and the panel says so.
   */
  temperature: number;
  tint: number;
  /** −100..100. */
  saturation: number;
  /**
   * −100..100. Saturation weighted by how UNsaturated a pixel already is —
   * the maintainer's "brillance"; a strongly coloured pixel barely moves,
   * which is what protects skin.
   */
  vibrance: number;
  /**
   * The five tone curves (`curves.ts`), or null for none. NOT a slider: it is
   * the control the eleven numbers above cannot express — one part of the
   * range moved while the rest stays. Optional so every stored develop
   * written before it existed reads without a migration.
   */
  curves?: ToneCurves | null;
  /** Levels per channel (`curves.ts`), or null for none. The same, coarser. */
  levels?: Levels | null;
}

/** The NUMERIC fields — a key a panel can draw as a slider. */
export type DevelopKey = Exclude<keyof DevelopSettings, 'curves' | 'levels'>;

/** The sliders, in the order every panel draws them. */
export const DEVELOP_KEYS: readonly DevelopKey[] = [
  'exposure',
  'brightness',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'temperature',
  'tint',
  'saturation',
  'vibrance',
];

/** A slider's bounds and step, as a panel draws them. */
export interface DevelopRange {
  min: number;
  max: number;
  step: number;
  /** Printed beside the number: "EV" for exposure, nothing for the rest. */
  unit: string;
}

const STOPS: DevelopRange = { min: -3, max: 3, step: 0.05, unit: 'EV' };
const HUNDRED: DevelopRange = { min: -100, max: 100, step: 1, unit: '' };

export const DEVELOP_RANGES: Readonly<Record<DevelopKey, DevelopRange>> = {
  exposure: STOPS,
  brightness: HUNDRED,
  contrast: HUNDRED,
  highlights: HUNDRED,
  shadows: HUNDRED,
  whites: HUNDRED,
  blacks: HUNDRED,
  temperature: HUNDRED,
  tint: HUNDRED,
  saturation: HUNDRED,
  vibrance: HUNDRED,
};

/** Every field at 0 — "as shot". The identity on every pixel. */
export const DEFAULT_DEVELOP: Readonly<DevelopSettings> = Object.freeze({
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  vibrance: 0,
  curves: null,
  levels: null,
});

export function isDefaultDevelop(d: DevelopSettings | null | undefined): boolean {
  if (!d) return true;
  return DEVELOP_KEYS.every((k) => d[k] === 0) && isDefaultCurves(d.curves) && isDefaultLevels(d.levels);
}

/**
 * A DEEP copy. The record stopped being flat numbers when it gained curves and
 * levels, so a `{ ...settings }` now shares its nested shapes: a preset and the
 * picture it was saved from would hold the SAME point list, and an editor that
 * moved a point would move both. Everything that keeps a develop for later — the
 * clipboard, a preset, a batch verb — clones through here.
 */
export function cloneDevelop(d: DevelopSettings | null | undefined): DevelopSettings {
  const src = d ?? DEFAULT_DEVELOP;
  const out = { ...DEFAULT_DEVELOP, ...src };
  out.curves = cloneCurves(src.curves);
  out.levels = cloneLevels(src.levels);
  return out;
}

/**
 * Two stored develops say the same thing — null and an untouched set are both
 * "as shot". Curves and levels are compared by VALUE: reference equality would
 * report every remount as a change and dirty a document that did not move.
 */
export function sameDevelop(a: DevelopSettings | null | undefined, b: DevelopSettings | null | undefined): boolean {
  const x = { ...DEFAULT_DEVELOP, ...(a ?? {}) };
  const y = { ...DEFAULT_DEVELOP, ...(b ?? {}) };
  return (
    DEVELOP_KEYS.every((k) => x[k] === y[k]) &&
    sameCurves(x.curves, y.curves) &&
    sameLevels(x.levels, y.levels)
  );
}

/**
 * A stored develop, read back safely: every field clamped to its range, a
 * missing or non-finite one taken as 0. For a document migration and for a
 * file off a stranger's disk — a NaN in a slider would poison a whole bake.
 */
export function normaliseDevelop(raw: unknown): DevelopSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_DEVELOP };
  for (const k of DEVELOP_KEYS) {
    const v = src[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const { min, max } = DEVELOP_RANGES[k];
    out[k] = v < min ? min : v > max ? max : v;
  }
  out.curves = curvesOrNull(normaliseCurves(src.curves));
  out.levels = levelsOrNull(normaliseLevels(src.levels));
  return out;
}

/**
 * A stored develop as a DOCUMENT holds it: `null` for "as shot", so a picture
 * nobody corrected stores nothing — the "empty means computed" rule, where
 * computed is the identity. Reads anything (a migration's unknown, a file's
 * junk) and answers null for a default or unreadable value.
 */
export function developOrNull(raw: unknown): DevelopSettings | null {
  if (raw === null || raw === undefined) return null;
  const d = normaliseDevelop(raw);
  return isDefaultDevelop(d) ? null : d;
}

/** A named develop kept on a document, applied by a click — never followed. */
export interface DevelopPreset {
  id: string;
  name: string;
  settings: DevelopSettings;
}

/** Presets as a document holds them, read back safely: junk entries dropped. */
export function normaliseDevelopPresets(raw: unknown): DevelopPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: DevelopPreset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id || typeof e.name !== 'string') continue;
    out.push({ id: e.id, name: e.name, settings: normaliseDevelop(e.settings) });
  }
  return out;
}

// --- the maths --------------------------------------------------------------

/** Rec.709 / sRGB luminance weights, in linear light. */
const LUM_R = 0.2126;
const LUM_G = 0.7152;
const LUM_B = 0.0722;

/**
 * 18 % grey, where contrast pivots — in the encoded domain the curve works
 * in, so the pivot is a code, not a light level.
 */
const CONTRAST_PIVOT = fromLinear(0.18, 'srgb');

/** How far a band moves the encoded luminance at full slider and full weight. */
const HIGHLIGHTS_REACH = 0.15;
const SHADOWS_REACH = 0.15;
const WHITES_REACH = 0.2;
const BLACKS_REACH = 0.2;
/** Contrast −100..100 → slope 0.4..1.6 around the pivot. */
const CONTRAST_REACH = 0.6;
/** Brightness −100..100 → gamma 2 .. 1/1.5. */
const BRIGHTNESS_REACH = 0.5;
/** Temperature ±100 → the red and blue gains move ±25 % against each other. */
const TEMPERATURE_REACH = 0.25;
/** Tint ±100 → the green gain moves ∓20 %. */
const TINT_REACH = 0.2;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The four band weights over an encoded luminance L in [0,1]. Each band is
 * zero outside its half and at the end the neighbouring band owns, so the
 * controls do not fight: shadows and highlights are bumps peaking at 1/4 and
 * 3/4 (zero at both ends of their half), blacks and whites ramp to the
 * extreme and are zero at mid-grey.
 */
function bandWeights(L: number): { hi: number; sh: number; wh: number; bl: number } {
  if (L <= 0.5) {
    const u = L / 0.5; // 0..1 across the lower half
    return { hi: 0, wh: 0, sh: 4 * u * (1 - u), bl: (1 - u) * (1 - u) };
  }
  const u = (L - 0.5) / 0.5; // 0..1 across the upper half
  return { hi: 4 * u * (1 - u), wh: u * u, sh: 0, bl: 0 };
}

/**
 * The luminance curve: encoded luminance in, encoded luminance out. Bands,
 * then contrast, then brightness — each stage sees the previous one's
 * result, and the order is fixed so two documents never disagree.
 */
function toneCurve(L: number, d: DevelopSettings): number {
  let v = L;
  if (d.highlights || d.shadows || d.whites || d.blacks) {
    const w = bandWeights(v);
    v +=
      (d.highlights / 100) * HIGHLIGHTS_REACH * w.hi +
      (d.shadows / 100) * SHADOWS_REACH * w.sh +
      (d.whites / 100) * WHITES_REACH * w.wh +
      (d.blacks / 100) * BLACKS_REACH * w.bl;
    v = clamp01(v);
  }
  if (d.contrast) {
    const slope = 1 + (d.contrast / 100) * CONTRAST_REACH;
    v = clamp01(CONTRAST_PIVOT + (v - CONTRAST_PIVOT) * slope);
  }
  if (d.brightness) {
    // A gamma keeps both ends fixed: +100 lifts a mid-grey, −100 sinks it.
    const gamma = 1 / (1 + (d.brightness / 100) * BRIGHTNESS_REACH);
    v = Math.pow(v, gamma);
  }
  return v;
}

/**
 * The curve and level maps a develop needs, resolved ONCE — the `makeTransfer`
 * rule. A develop with neither is the common case and pays nothing.
 */
export interface DevelopShapers {
  /** The luma curve on encoded LUMINANCE, applied as a ratio. */
  luma: ((L: number) => number) | null;
  /** Levels and the rgb / per-channel curves, on encoded channel values. */
  channels: ChannelShaper | null;
}

const NO_SHAPERS: DevelopShapers = Object.freeze({ luma: null, channels: null });

export function makeDevelopShapers(d: DevelopSettings): DevelopShapers {
  if (isDefaultCurves(d.curves) && isDefaultLevels(d.levels)) return NO_SHAPERS;
  return { luma: makeLumaShaper(d.curves), channels: makeChannelShaper(d.curves, d.levels) };
}

/**
 * One channel through the per-channel map. A curve is DISPLAY-REFERRED: it is
 * drawn on [0,1], so a pixel carrying a RAW's headroom is read at white. Where
 * the map leaves that value alone the linear value is handed back UNTOUCHED, so
 * headroom survives a curve that does not reach it — and an unshaped pixel is
 * bit-identical, the encode/decode pair not being exact to the last ulp.
 */
function shapeChannel(lin: number, channel: 0 | 1 | 2, shape: ChannelShaper): number {
  const encoded = fromLinear(lin > 1 ? 1 : lin, 'srgb');
  const out = shape(encoded, channel);
  return out === encoded ? lin : toLinear(out, 'srgb');
}

/**
 * Develop one pixel in LINEAR light. Input is ≥ 0 and may exceed 1 (a RAW's
 * headroom); output is ≥ 0 and is NOT clamped — the caller encodes and
 * clamps for its own medium. The identity when every field is 0.
 *
 * Order: white balance → exposure → the luminance curve as one ratio → the
 * luma curve, also as a ratio → levels and the per-channel curves → saturation
 * and vibrance around the new luminance.
 *
 * `shapers` is the resolved curve/level maps. Pass it in any loop —
 * `developStage` does; omitting it resolves them per pixel, which is only
 * right for a one-off call.
 */
export function developLinear(
  rgb: readonly [number, number, number],
  d: DevelopSettings,
  shapers: DevelopShapers = makeDevelopShapers(d),
): [number, number, number] {
  let r = rgb[0] < 0 ? 0 : rgb[0];
  let g = rgb[1] < 0 ? 0 : rgb[1];
  let b = rgb[2] < 0 ? 0 : rgb[2];

  if (d.temperature) {
    const t = (d.temperature / 100) * TEMPERATURE_REACH;
    r *= 1 + t;
    b *= 1 - t;
  }
  if (d.tint) {
    g *= 1 - (d.tint / 100) * TINT_REACH;
  }
  if (d.exposure) {
    const gain = Math.pow(2, d.exposure);
    r *= gain;
    g *= gain;
    b *= gain;
  }

  const Y = LUM_R * r + LUM_G * g + LUM_B * b;
  if (Y > 0 && (d.highlights || d.shadows || d.whites || d.blacks || d.contrast || d.brightness)) {
    // The curve is defined on [0,1]; a pixel above white is pulled by the
    // same ratio its clipped luminance would be, which is how "whites −100"
    // reaches into a RAW's headroom.
    const Yc = Y > 1 ? 1 : Y;
    const L = fromLinear(Yc, 'srgb');
    const Lout = toneCurve(L, d);
    // A pixel the curve did not move is left bit-identical: the encode/decode
    // pair is not exact to the last ulp, and "untouched" must mean untouched.
    if (Lout !== L) {
      const ratio = toLinear(Lout, 'srgb') / Yc;
      r *= ratio;
      g *= ratio;
      b *= ratio;
    }
  }

  // The luma curve rides the same ratio as the sliders' curve, for the same
  // reason: a grey must stay grey and no hue may rotate.
  if (shapers.luma) {
    const Yl = LUM_R * r + LUM_G * g + LUM_B * b;
    if (Yl > 0) {
      const Yc = Yl > 1 ? 1 : Yl;
      const L = fromLinear(Yc, 'srgb');
      const Lout = shapers.luma(L);
      if (Lout !== L) {
        const ratio = toLinear(Lout, 'srgb') / Yc;
        r *= ratio;
        g *= ratio;
        b *= ratio;
      }
    }
  }

  // Levels and the rgb / per-channel curves, which move channels against each
  // other on purpose — that is what tells them from the luma curve above.
  if (shapers.channels) {
    r = shapeChannel(r, 0, shapers.channels);
    g = shapeChannel(g, 1, shapers.channels);
    b = shapeChannel(b, 2, shapers.channels);
  }

  if (d.saturation || d.vibrance) {
    const Y2 = LUM_R * r + LUM_G * g + LUM_B * b;
    let amount = d.saturation / 100;
    if (d.vibrance) {
      // How coloured the pixel already is, 0 (grey) .. 1 (a pure primary).
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max > 0 ? (max - min) / max : 0;
      amount += (d.vibrance / 100) * (1 - sat);
    }
    if (amount) {
      const k = 1 + amount;
      r = Y2 + (r - Y2) * k;
      g = Y2 + (g - Y2) * k;
      b = Y2 + (b - Y2) * k;
      if (r < 0) r = 0;
      if (g < 0) g = 0;
      if (b < 0) b = 0;
    }
  }

  return [r, g, b];
}

/**
 * The develop as a stage for the LUT bake: sRGB codes in [0,1] in, sRGB codes
 * in [0,1] out. Resolve it ONCE and call it per lattice point (the
 * `makeTransfer` rule). The identity — the very same values — when the
 * develop is default, so a caller may apply it unconditionally.
 */
export function developStage(
  d: DevelopSettings,
): (r: number, g: number, b: number) => [number, number, number] {
  if (isDefaultDevelop(d)) return (r, g, b) => [r, g, b];
  const shapers = makeDevelopShapers(d);
  return (r, g, b) => {
    const out = developLinear(
      [toLinear(r, 'srgb'), toLinear(g, 'srgb'), toLinear(b, 'srgb')],
      d,
      shapers,
    );
    return [fromLinear(out[0], 'srgb'), fromLinear(out[1], 'srgb'), fromLinear(out[2], 'srgb')];
  };
}

// --- words ------------------------------------------------------------------

const LABELS: Readonly<Record<DevelopKey, string>> = {
  exposure: '',
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

/** `+0.7`, `−40` — a typographic minus, the way the suite prints numbers. */
export function signed(n: number, digits = 0): string {
  const abs = Math.abs(n).toFixed(digits);
  if (Number(abs) === 0) return '0';
  return n < 0 ? `−${abs}` : `+${abs}`;
}

/**
 * One line for a settled row: `As shot`, or the non-zero fields in slider
 * order — `+0.7 EV · highlights −40 · vibrance +15 · curve luma+red`. Exposure
 * leads and carries its unit; the others are `name value`. A shape has no one
 * number, so it names the channels it touches and nothing else — the row is a
 * sentence, not a serialisation.
 */
export function describeDevelop(d: DevelopSettings | null | undefined): string {
  if (!d || isDefaultDevelop(d)) return 'As shot';
  const parts: string[] = [];
  for (const k of DEVELOP_KEYS) {
    const v = d[k];
    if (!v) continue;
    if (k === 'exposure') parts.push(`${signed(v, 2).replace(/\.?0+$/, '')} EV`);
    else parts.push(`${LABELS[k]} ${signed(v)}`);
  }
  const levels = describeLevels(d.levels);
  if (levels) parts.push(levels);
  const curves = describeCurves(d.curves);
  if (curves) parts.push(curves);
  return parts.join(' · ');
}
