/**
 * COLOUR GRADING — Lightroom's wheels (audit item 14, `docs/lightroom-gaps.md`):
 * a colour and a luminance for the shadows, the midtones and the highlights,
 * one more for the whole picture, and the two numbers that say where the
 * three ranges meet (Balance) and how much they overlap (Blending).
 *
 * A stage of the develop (`develop.ts`), after the colour mixer — Lightroom's
 * order — so it bakes into the one cube like every other number, and reaches
 * the stage, every export, every layer, the presets and the clipboard.
 *
 * Rules:
 *
 * - **The three ranges are a partition of unity** over the pixel's encoded
 *   luma: shadows fall from black to a pivot, highlights rise from the pivot
 *   to white, the midtones are what is left, peaking AT the pivot. Balance
 *   moves the pivot (positive gives the highlights more of the range),
 *   Blending bends the two ramps (0 keeps each range near its end, 100
 *   lets it reach far into its neighbour).
 * - **A tint is a gain whose luminance is 1**, pulled toward the wheel's hue
 *   by its saturation, and the pixel is then brought back to the luminance it
 *   had — so a wheel colours and never brightens, and only the luminance
 *   slider under it moves the light. Black stays black.
 * - **Hue is degrees of the colour wheel** — 0 red, 120 green, 240 blue —
 *   stored even when the saturation is 0, so turning the saturation back up
 *   finds the colour where it was left.
 *
 * Pure and DOM-free. `wheelPoint` / `pointOnWheel` are the geometry the
 * wheels draw and read, kept here so a spec holds them.
 */

import { fromLinear, toLinear } from '../lut/transfer';

export const GRADE_ZONES = ['shadows', 'midtones', 'highlights', 'global'] as const;
export type GradeZone = (typeof GRADE_ZONES)[number];

export interface GradeWheel {
  /** 0..360 degrees. */
  hue: number;
  /** 0..100. */
  saturation: number;
  /** −100..100. */
  luminance: number;
}

export interface ColourGrading extends Record<GradeZone, GradeWheel> {
  /** 0..100, 50 by default: how far each range reaches into its neighbour. */
  blending: number;
  /** −100..100: where shadows end and highlights begin. Positive favours the highlights. */
  balance: number;
}

const NEUTRAL_WHEEL: Readonly<GradeWheel> = Object.freeze({ hue: 0, saturation: 0, luminance: 0 });

/** How far a full saturation pulls a channel's gain toward the hue — a strong tint, not a colour fill. */
export const TINT_REACH = 0.25;
/** A luminance slider at ±100 is ±1 stop, on a pixel wholly inside its range. */
export const ZONE_STOPS = 1;
/** The pivot moves at most this far from 0.5 at a full Balance. */
export const BALANCE_REACH = 0.25;

const LUM = [0.2126, 0.7152, 0.0722] as const;

export function neutralGrading(): ColourGrading {
  return {
    shadows: { ...NEUTRAL_WHEEL },
    midtones: { ...NEUTRAL_WHEEL },
    highlights: { ...NEUTRAL_WHEEL },
    global: { ...NEUTRAL_WHEEL },
    blending: 50,
    balance: 0,
  };
}

const wheelIsNeutral = (w: GradeWheel) => w.saturation === 0 && w.luminance === 0;

/** Nothing moves: every wheel without colour and without light. Blending and balance alone shape nothing. */
export function isDefaultGrading(g: ColourGrading | null | undefined): boolean {
  return !g || GRADE_ZONES.every((z) => wheelIsNeutral(g[z]));
}

export function cloneGrading(g: ColourGrading | null | undefined): ColourGrading | null {
  if (!g) return null;
  return {
    shadows: { ...g.shadows },
    midtones: { ...g.midtones },
    highlights: { ...g.highlights },
    global: { ...g.global },
    blending: g.blending,
    balance: g.balance,
  };
}

export function sameGrading(a: ColourGrading | null | undefined, b: ColourGrading | null | undefined): boolean {
  if (isDefaultGrading(a) || isDefaultGrading(b)) return isDefaultGrading(a) && isDefaultGrading(b);
  const x = a!;
  const y = b!;
  return (
    x.blending === y.blending &&
    x.balance === y.balance &&
    GRADE_ZONES.every(
      (z) => x[z].hue === y[z].hue && x[z].saturation === y[z].saturation && x[z].luminance === y[z].luminance,
    )
  );
}

const clampNum = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;

/** A stored grading, read back safely, or null for none — what a document and a stranger's file both go through. */
export function gradingOrNull(raw: unknown): ColourGrading | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out = neutralGrading();
  for (const z of GRADE_ZONES) {
    const w = (src[z] && typeof src[z] === 'object' ? src[z] : {}) as Record<string, unknown>;
    const hue = clampNum(w.hue, -Infinity, Infinity, 0);
    out[z] = {
      hue: ((hue % 360) + 360) % 360,
      saturation: clampNum(w.saturation, 0, 100, 0),
      luminance: clampNum(w.luminance, -100, 100, 0),
    };
  }
  out.blending = clampNum(src.blending, 0, 100, 50);
  out.balance = clampNum(src.balance, -100, 100, 0);
  return isDefaultGrading(out) ? null : out;
}

/** `g` with one wheel replaced; null when that leaves nothing — the "empty means none" rule. */
export function withWheel(g: ColourGrading | null | undefined, zone: GradeZone, wheel: GradeWheel): ColourGrading | null {
  const next = cloneGrading(g) ?? neutralGrading();
  next[zone] = { ...wheel };
  return isDefaultGrading(next) ? null : next;
}

/** `g` with Blending or Balance set — kept even while no wheel moves, so the panel does not jump back. */
export function withShape(g: ColourGrading | null | undefined, key: 'blending' | 'balance', value: number): ColourGrading {
  const next = cloneGrading(g) ?? neutralGrading();
  next[key] = value;
  return next;
}

/**
 * The weights of shadows, midtones and highlights at an encoded luma — they
 * sum to 1. The pivot is where the midtones peak.
 */
export function zoneWeights(L: number, blending = 50, balance = 0): { shadows: number; midtones: number; highlights: number } {
  const l = L < 0 ? 0 : L > 1 ? 1 : L;
  const pivot = 0.5 - (balance / 100) * BALANCE_REACH;
  // Blending 50 → straight ramps; 100 → the square root, reaching far; 0 → the square, staying near the end.
  const gamma = Math.pow(2, (50 - blending) / 50);
  const shadows = l < pivot ? Math.pow((pivot - l) / pivot, gamma) : 0;
  const highlights = l > pivot ? Math.pow((l - pivot) / (1 - pivot), gamma) : 0;
  return { shadows, midtones: 1 - shadows - highlights, highlights };
}

/** The wheel's hue as a per-channel gain in LINEAR light whose luminance is exactly 1. */
export function hueGain(hue: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const seg = Math.floor(h) % 6;
  const [r, g, b] =
    seg === 0 ? [1, x, 0] : seg === 1 ? [x, 1, 0] : seg === 2 ? [0, 1, x] : seg === 3 ? [0, x, 1] : seg === 4 ? [x, 0, 1] : [1, 0, x];
  const lin = [toLinear(r, 'srgb'), toLinear(g, 'srgb'), toLinear(b, 'srgb')];
  const y = LUM[0] * lin[0] + LUM[1] * lin[1] + LUM[2] * lin[2];
  return [lin[0] / y, lin[1] / y, lin[2] / y];
}

/**
 * One pixel in LINEAR light through the grading; the very same values when
 * nothing is set. Every wheel's weight is taken at the pixel's luma as it
 * ENTERS the stage, so a wheel's own luminance cannot move a pixel into
 * another range half-way.
 */
export function gradeLinear(rgb: readonly [number, number, number], g: ColourGrading): [number, number, number] {
  let [r, gg, b] = rgb;
  const Y0 = LUM[0] * r + LUM[1] * gg + LUM[2] * b;
  if (Y0 <= 0) return [r, gg, b];
  const L = fromLinear(Y0 > 1 ? 1 : Y0, 'srgb');
  const w = zoneWeights(L, g.blending, g.balance);
  const weights: Record<GradeZone, number> = { ...w, global: 1 };
  let stops = 0;
  let moved = false;
  for (const zone of GRADE_ZONES) {
    const wheel = g[zone];
    const k = weights[zone];
    if (!k || wheelIsNeutral(wheel)) continue;
    moved = true;
    stops += (wheel.luminance / 100) * ZONE_STOPS * k;
    if (wheel.saturation) {
      const t = (wheel.saturation / 100) * TINT_REACH * k;
      const [gr, ggn, gb] = hueGain(wheel.hue);
      r *= 1 + t * (gr - 1);
      gg *= 1 + t * (ggn - 1);
      b *= 1 + t * (gb - 1);
    }
  }
  if (!moved) return [r, gg, b];
  // Back to the light it had, then the light the sliders ask for.
  const Y1 = LUM[0] * r + LUM[1] * gg + LUM[2] * b;
  const k = Y1 > 0 ? (Y0 / Y1) * Math.pow(2, stops) : 1;
  return [r * k, gg * k, b * k];
}

// --- the wheel's geometry ----------------------------------------------------

/**
 * A point on a wheel of radius 1 (x right, y DOWN — screen space) as a hue
 * and a saturation: 0° at the right, turning clockwise on screen, the
 * saturation the distance from the centre, clamped to the rim.
 */
export function wheelPoint(x: number, y: number): { hue: number; saturation: number } {
  const d = Math.hypot(x, y);
  const hue = d > 0 ? ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 : 0;
  return { hue: Math.round(hue), saturation: Math.round(Math.min(1, d) * 100) };
}

/** Where a hue and saturation sit on that wheel — the inverse of `wheelPoint`. */
export function pointOnWheel(hue: number, saturation: number): { x: number; y: number } {
  const a = (hue * Math.PI) / 180;
  const d = Math.max(0, Math.min(100, saturation)) / 100;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d };
}

const ZONE_WORDS: Readonly<Record<GradeZone, string>> = {
  shadows: 'shadows',
  midtones: 'midtones',
  highlights: 'highlights',
  global: 'global',
};

export function zoneLabel(zone: GradeZone): string {
  return ZONE_WORDS[zone][0].toUpperCase() + ZONE_WORDS[zone].slice(1);
}

/** "grading shadows+highlights" — the ranges it touches, as `describeMixer` names its channels. */
export function describeGrading(g: ColourGrading | null | undefined): string | null {
  if (isDefaultGrading(g)) return null;
  const used = GRADE_ZONES.filter((z) => !wheelIsNeutral(g![z])).map((z) => ZONE_WORDS[z]);
  return `grading ${used.join('+')}`;
}
