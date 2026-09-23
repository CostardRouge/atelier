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

import type { SavedGrade } from '../lut/saved-grade';
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
import { cloneMixer, describeMixer, isDefaultMixer, mixLinear, mixerOrNull, sameMixer, type ColourMixer } from './mixer';
import {
  cloneGrading,
  describeGrading,
  gradeLinear,
  gradingOrNull,
  isDefaultGrading,
  sameGrading,
  type ColourGrading,
} from './grading';

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
  /**
   * The colour mixer (`mixer.ts`): hue, saturation and luminance for eight
   * bands of hue, or null for none — Lightroom's HSL. Last of the stages, as
   * there. Optional like the curves, so nothing stored before it migrates.
   */
  mixer?: ColourMixer | null;
  /**
   * Colour grading (`grading.ts`): a colour and a light for the shadows, the
   * midtones, the highlights and the whole picture — Lightroom's wheels —
   * after the mixer, as there. Optional, so nothing migrates.
   */
  grading?: ColourGrading | null;
  /**
   * The MATERIAL the numbers act on, as a LADDER of four rungs — each a real
   * and nameable amount of the camera's own calibration (2026-09-20,
   * `docs/develop-originals.md` §7 decision 1, `raw.md`):
   *
   * - absent / `proxy` — the 8-bit picture every browser decodes: a JPEG, a
   *   source's proxy, the render a camera wrote inside its RAW;
   * - `gain` — the sensor's own data decoded to linear light (`shared/raw/`),
   *   with the measured `rawGain` below;
   * - `gainMap` — and the DNG's GainMap applied, the shading the body was
   *   calibrated for (`render/gain-map.ts`);
   * - `gainMapWarp` — and its WarpRectilinear (`render/camera-warp.ts`).
   *
   * The top two are offered only where the FILE carries those opcodes: a
   * correction nobody measured is worse than none.
   *
   * Not a slider: a property of THIS picture, chosen in Develop, never copied
   * by a preset, a paste or a batch verb (`withoutBase`), and never switched
   * DOWN by an export. Stored only for the RAW rungs — `proxy` IS the
   * absence, which is what keeps "empty means as shot" true and what made the
   * `render` → `proxy` migration cost nothing.
   */
  base?: DevelopBase | null;
  /**
   * With a `raw` base, the picture's own exposure as MEASURED at decode
   * (`autoBrightGain`): a linear gain the develop stage applies before the
   * sliders, so the same number reaches a decode of another size at export.
   * Stored rather than re-measured, because two decodes measure two numbers
   * and preview = export is a promise. Absent means 1.
   */
  rawGain?: number | null;
}

/** The NUMERIC fields — a key a panel can draw as a slider. */
export type DevelopKey = Exclude<keyof DevelopSettings, 'curves' | 'levels' | 'mixer' | 'grading' | 'base' | 'rawGain'>;

/**
 * The rungs of the material ladder, lowest first. `proxy` is never stored —
 * it is the absence of a base — so the three above it are what a document
 * ever holds.
 */
export type DevelopBase = 'proxy' | 'gain' | 'gainMap' | 'gainMapWarp';

/** The ladder in order, so a caller can climb or compare without a switch. */
export const DEVELOP_BASES: readonly DevelopBase[] = ['proxy', 'gain', 'gainMap', 'gainMapWarp'];

/** How far up the ladder a base sits; 0 for the proxy and for none at all. */
export function baseRung(base: DevelopBase | null | undefined): number {
  const i = base ? DEVELOP_BASES.indexOf(base) : 0;
  return i < 0 ? 0 : i;
}

/** What a rung is called on screen, and what it ADDS to the one below. */
export const BASE_LABELS: Readonly<Record<DevelopBase, string>> = Object.freeze({
  proxy: 'Proxy',
  gain: 'Gain',
  gainMap: 'Gain map',
  gainMapWarp: 'Gain map + warp',
});

/**
 * Yesterday's two values, read as today's four. `render` was the proxy and
 * `raw` was the sensor with its measured gain and nothing else — which is
 * exactly what `gain` means, so no stored document changes meaning.
 */
export function normaliseBase(raw: unknown): DevelopBase | null {
  if (raw === 'raw') return 'gain';
  if (raw === 'render') return null;
  return typeof raw === 'string' && (DEVELOP_BASES as readonly string[]).includes(raw) && raw !== 'proxy'
    ? (raw as DevelopBase)
    : null;
}

/** The gain a RAW develop may carry: 4 stops either way is every exposure a camera meters. */
export const RAW_GAIN_LIMITS = { min: 1 / 16, max: 16 } as const;

/** This develop acts on the sensor's own data — any rung above the proxy. */
export function isRawDevelop(d: DevelopSettings | null | undefined): boolean {
  return baseRung(d?.base) > 0;
}

/** Which rung this develop stands on. */
export function developBase(d: DevelopSettings | null | undefined): DevelopBase {
  return d?.base && baseRung(d.base) > 0 ? d.base : 'proxy';
}

/** The linear gain a RAW develop applies before its sliders; 1 for a render. */
export function rawGainOf(d: DevelopSettings | null | undefined): number {
  if (!isRawDevelop(d)) return 1;
  const g = d?.rawGain;
  return typeof g === 'number' && Number.isFinite(g) && g > 0 ? g : 1;
}

/**
 * The same numbers on NO particular material — what a preset, the clipboard
 * and a batch verb carry. A base is a fact about one picture's bytes; copying
 * it onto a JPEG would apply a RAW's gain to a render, four stops too bright.
 */
export function withoutBase(d: DevelopSettings): DevelopSettings {
  return { ...d, base: null, rawGain: null };
}

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
  mixer: null,
  grading: null,
  base: null,
  rawGain: null,
});

/**
 * Nothing changes the picture. A RAW base is NOT default even with every
 * slider at 0: the material itself is a change, and its measured gain is
 * applied before any slider.
 */
export function isDefaultDevelop(d: DevelopSettings | null | undefined): boolean {
  if (!d) return true;
  return (
    !isRawDevelop(d) &&
    DEVELOP_KEYS.every((k) => d[k] === 0) &&
    isDefaultCurves(d.curves) &&
    isDefaultLevels(d.levels) &&
    isDefaultMixer(d.mixer) &&
    isDefaultGrading(d.grading)
  );
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
  out.mixer = cloneMixer(src.mixer);
  out.grading = cloneGrading(src.grading);
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
    sameLevels(x.levels, y.levels) &&
    sameMixer(x.mixer, y.mixer) &&
    sameGrading(x.grading, y.grading) &&
    isRawDevelop(x) === isRawDevelop(y) &&
    rawGainOf(x) === rawGainOf(y)
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
  out.mixer = mixerOrNull(src.mixer);
  out.grading = gradingOrNull(src.grading);
  const base = normaliseBase(src.base);
  if (base) {
    out.base = base;
    const g = src.rawGain;
    out.rawGain =
      typeof g === 'number' && Number.isFinite(g) && g > 0
        ? Math.min(RAW_GAIN_LIMITS.max, Math.max(RAW_GAIN_LIMITS.min, g))
        : null;
  }
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
  /**
   * The LOOK saved with the light, when its author ticked it (2026-09-23,
   * `docs/lightroom-gaps.md` item 6): since roll v5 a look is per picture, so
   * "Portra + my curve" was two gestures on every picture. Applied where a
   * picture owns its look — the Develop tool; Trips and the Studio sheets
   * apply the numbers and say the look stays behind. Absent is a light alone.
   */
  look?: SavedGrade;
}

/**
 * Presets as a document holds them, read back safely: junk entries dropped.
 * `readLook` reads a preset's look where the caller knows how (the preset
 * book passes the roll's grade reader); without it a look is dropped.
 */
export function normaliseDevelopPresets(raw: unknown, readLook?: (raw: unknown) => SavedGrade | null): DevelopPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: DevelopPreset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id || typeof e.name !== 'string') continue;
    const look = readLook && e.look !== undefined ? readLook(e.look) : null;
    out.push({ id: e.id, name: e.name, settings: normaliseDevelop(e.settings), ...(look ? { look } : {}) });
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
export const TEMPERATURE_REACH = 0.25;
/** Tint ±100 → the green gain moves ∓20 %. */
export const TINT_REACH = 0.2;

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
 * and vibrance around the new luminance → the colour mixer (`mixer.ts`) →
 * colour grading (`grading.ts`).
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

  // The colour mixer last, as in Lightroom: a band is picked on the colour
  // the pixel HAS once every global move is made.
  if (d.mixer && !isDefaultMixer(d.mixer)) [r, g, b] = mixLinear([r, g, b], d.mixer);
  // Then the wheels, which colour the RANGES of the picture as it now is.
  if (d.grading && !isDefaultGrading(d.grading)) [r, g, b] = gradeLinear([r, g, b], d.grading);

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
  // On a RAW the lattice's [0,1] is the SENSOR's range, white at its
  // saturation, and the measured gain brings the picture to its own
  // exposure before any slider — which is how a value the sensor kept above
  // the displayed white is still there for "highlights −100" to reach.
  const gain = rawGainOf(d);
  return (r, g, b) => {
    const out = developLinear(
      [toLinear(r, 'srgb') * gain, toLinear(g, 'srgb') * gain, toLinear(b, 'srgb') * gain],
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
 * What this develop says, ONE FACT PER ENTRY: `As shot` alone, or the non-zero
 * fields in slider order — `+0.7 EV`, `highlights −40`, `vibrance +15`,
 * `curve luma+red`. Exposure leads and carries its unit; the others are
 * `name value`. A shape has no one number, so it names the channels it touches
 * and nothing else — these are sentences, not a serialisation.
 *
 * Kept as a LIST because the two readers want different shapes: a settled row
 * wants one line (`describeDevelop` joins it), the facts drawn over the picture
 * want a stack, where a long correction that used to wrap mid-fact now reads
 * down a corner.
 */
export function developLines(d: DevelopSettings | null | undefined): string[] {
  if (!d || isDefaultDevelop(d)) return ['As shot'];
  const parts: string[] = [];
  if (isRawDevelop(d)) {
    // The material first, with the exposure it was measured at — a fact about
    // the bytes the sliders below act on.
    const ev = Math.log2(rawGainOf(d));
    // The rung too, where it is above the bare sensor: "RAW" alone would let
    // a picture with 2.5 stops of shading taken out of its corners read the
    // same as one without — the corner stack says what was applied.
    const rung = developBase(d);
    const adds = rung === 'gainMapWarp' ? ' + gain map + warp' : rung === 'gainMap' ? ' + gain map' : '';
    parts.push(`RAW${adds}${ev ? ` ${signed(ev, 1)} EV metered` : ''}`);
  }
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
  const mixer = describeMixer(d.mixer);
  if (mixer) parts.push(mixer);
  const grading = describeGrading(d.grading);
  if (grading) parts.push(grading);
  return parts;
}

/** The same facts as ONE line, for a settled row. */
export function describeDevelop(d: DevelopSettings | null | undefined): string {
  return developLines(d).join(' · ');
}
