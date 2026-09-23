/**
 * The COLOUR MIXER — Lightroom's HSL panel (audit item 12,
 * `docs/lightroom-gaps.md`): eight bands of hue, each with its own hue shift,
 * saturation and luminance, so a sky can be darkened and a lawn calmed
 * without touching a face.
 *
 * A stage of the develop (`develop.ts`, last, after saturation and vibrance —
 * Lightroom's order), so it bakes into the one cube with every other number
 * and reaches the stage, every export and every layer for nothing.
 *
 * Three rules shape it:
 *
 * - **The bands are a partition of unity.** A pixel's weights over the eight
 *   bands sum to 1 — a raised cosine between two neighbouring centres — so
 *   moving every band by the same amount moves every colour by that amount,
 *   and no hue falls between two bands into a hole.
 * - **A grey stays grey.** Each move is weighted by how coloured the pixel is
 *   (`chromaWeight`), zero at no colour: a hue has no meaning on a grey, and a
 *   "blue luminance −100" that darkened a white wall would be a bug.
 * - **A hue shift keeps the light.** Rotating yellow toward green in any RGB
 *   model changes its brightness; the shifted pixel is scaled back to the
 *   luminance it had, so the hue slider does not double as a luminance one.
 *
 * Hue and colourfulness are read on the ENCODED values (what the eye and the
 * band names mean — "orange" is an sRGB orange), the moves are made in linear
 * light like every other stage, and a value above white (a RAW's headroom) is
 * read on its colour, scaled into range, and scaled back.
 *
 * Pure and DOM-free.
 */

import { fromLinear, toLinear } from '../lut/transfer';

export const MIXER_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type MixerBand = (typeof MIXER_BANDS)[number];

/** Where each band peaks, in degrees of sRGB hue — Lightroom's eight, unevenly spaced as the eye is. */
export const BAND_CENTRES: Readonly<Record<MixerBand, number>> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 225,
  purple: 270,
  magenta: 315,
};

export const MIXER_CHANNELS = ['hue', 'saturation', 'luminance'] as const;
export type MixerChannel = (typeof MIXER_CHANNELS)[number];

/** Each channel: one value per band, −100..100, in `MIXER_BANDS` order. */
export type ColourMixer = Record<MixerChannel, number[]>;

/** Hue ±100 → a shift of ±30°, half-way to the next band — never past it. */
export const HUE_REACH = 30;
/** Luminance ±100 → ±1.5 stops on a fully coloured pixel: a blue sky at −100 goes to a deep one, not to black. */
export const LUMINANCE_REACH = 1.5;

const LUM = [0.2126, 0.7152, 0.0722] as const;

/** Every band at 0. */
export function emptyMixer(): ColourMixer {
  return { hue: Array(8).fill(0), saturation: Array(8).fill(0), luminance: Array(8).fill(0) };
}

export function isDefaultMixer(m: ColourMixer | null | undefined): boolean {
  return !m || MIXER_CHANNELS.every((c) => m[c].every((v) => v === 0));
}

export function cloneMixer(m: ColourMixer | null | undefined): ColourMixer | null {
  return m ? { hue: [...m.hue], saturation: [...m.saturation], luminance: [...m.luminance] } : null;
}

export function sameMixer(a: ColourMixer | null | undefined, b: ColourMixer | null | undefined): boolean {
  if (isDefaultMixer(a) || isDefaultMixer(b)) return isDefaultMixer(a) && isDefaultMixer(b);
  return MIXER_CHANNELS.every((c) => a![c].every((v, i) => v === b![c][i]));
}

/**
 * A stored mixer, read back safely — eight finite numbers per channel,
 * clamped, a missing one taken as 0 — or null for none. What a document and a
 * stranger's file both go through.
 */
export function mixerOrNull(raw: unknown): ColourMixer | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out = emptyMixer();
  for (const c of MIXER_CHANNELS) {
    const list = src[c];
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < 8; i++) {
      const v = list[i];
      if (typeof v === 'number' && Number.isFinite(v)) out[c][i] = Math.max(-100, Math.min(100, v));
    }
  }
  return isDefaultMixer(out) ? null : out;
}

/** `mixer` with one value set; null when that leaves nothing. */
export function withMixerValue(
  m: ColourMixer | null | undefined,
  channel: MixerChannel,
  band: MixerBand,
  value: number,
): ColourMixer | null {
  const next = cloneMixer(m) ?? emptyMixer();
  next[channel][MIXER_BANDS.indexOf(band)] = value;
  return isDefaultMixer(next) ? null : next;
}

/** `mixer` with one channel's eight values back at 0; null when that leaves nothing. */
export function withoutMixerChannel(m: ColourMixer | null | undefined, channel: MixerChannel): ColourMixer | null {
  const next = cloneMixer(m) ?? emptyMixer();
  next[channel] = Array(8).fill(0);
  return isDefaultMixer(next) ? null : next;
}

/**
 * Each band's weight at `hue` (degrees, any turn): a raised cosine between
 * the two centres the hue sits between, so the eight sum to exactly 1.
 */
export function bandWeights(hue: number): number[] {
  const h = ((hue % 360) + 360) % 360;
  const centres = MIXER_BANDS.map((b) => BAND_CENTRES[b]);
  const out = Array(8).fill(0);
  for (let i = 0; i < 8; i++) {
    const from = centres[i];
    const to = i === 7 ? 360 : centres[i + 1];
    if (h >= from && h < to) {
      const t = (h - from) / (to - from);
      const w = 0.5 + 0.5 * Math.cos(Math.PI * t);
      out[i] = w;
      out[(i + 1) % 8] = 1 - w;
      return out;
    }
  }
  out[0] = 1;
  return out;
}

/**
 * How much of a move a pixel takes, from its HSV saturation on the encoded
 * values: 0 for a grey, rising to 1 by half saturation — skin and a hazy sky
 * are well coloured without being pure, and a mixer that barely reached them
 * would be a mixer for primaries only.
 */
export function chromaWeight(s: number): number {
  return s <= 0 ? 0 : s >= 0.5 ? 1 : s / 0.5;
}

/** Hue in degrees and HSV saturation of an ENCODED pixel in [0,1]. */
export function hueSat(r: number, g: number, b: number): { hue: number; sat: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (max <= 0 || d <= 0) return { hue: 0, sat: 0 };
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, sat: d / max };
}

/** An encoded pixel with its hue turned by `degrees`, value and saturation kept (HSV). */
function rotateHue(r: number, g: number, b: number, degrees: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const { hue } = hueSat(r, g, b);
  const h = (((hue + degrees) % 360) + 360) % 360;
  const c = max - min;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const seg = Math.floor(h / 60) % 6;
  const [r1, g1, b1] =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  return [r1 + min, g1 + min, b1 + min];
}

/**
 * One pixel in LINEAR light through the mixer; the very same values when the
 * pixel is grey or the bands it sits in are at 0.
 */
export function mixLinear(rgb: readonly [number, number, number], m: ColourMixer): [number, number, number] {
  let [r, g, b] = rgb;
  // A value above white is read on its COLOUR: scaled into range, mixed, and
  // scaled back, so a RAW's headroom keeps its hue and its brightness.
  const top = Math.max(r, g, b);
  const scale = top > 1 ? top : 1;
  const er = fromLinear(r / scale, 'srgb');
  const eg = fromLinear(g / scale, 'srgb');
  const eb = fromLinear(b / scale, 'srgb');
  const { hue, sat } = hueSat(er, eg, eb);
  const reach = chromaWeight(sat);
  if (reach <= 0) return [r, g, b];
  const w = bandWeights(hue);
  let dh = 0;
  let ds = 0;
  let dl = 0;
  for (let i = 0; i < 8; i++) {
    if (!w[i]) continue;
    dh += w[i] * m.hue[i];
    ds += w[i] * m.saturation[i];
    dl += w[i] * m.luminance[i];
  }
  if (!dh && !ds && !dl) return [r, g, b];

  const Y0 = LUM[0] * r + LUM[1] * g + LUM[2] * b;
  if (dh) {
    const [hr, hg, hb] = rotateHue(er, eg, eb, (dh / 100) * HUE_REACH * reach);
    r = toLinear(hr, 'srgb') * scale;
    g = toLinear(hg, 'srgb') * scale;
    b = toLinear(hb, 'srgb') * scale;
    // The light it had: rotating toward yellow brightens, toward blue darkens.
    const Y1 = LUM[0] * r + LUM[1] * g + LUM[2] * b;
    if (Y1 > 0) {
      const k = Y0 / Y1;
      r *= k;
      g *= k;
      b *= k;
    }
  }
  if (ds) {
    const k = 1 + (ds / 100) * reach;
    r = Y0 + (r - Y0) * k;
    g = Y0 + (g - Y0) * k;
    b = Y0 + (b - Y0) * k;
    if (r < 0) r = 0;
    if (g < 0) g = 0;
    if (b < 0) b = 0;
  }
  if (dl) {
    const gain = Math.pow(2, (dl / 100) * LUMINANCE_REACH * reach);
    r *= gain;
    g *= gain;
    b *= gain;
  }
  return [r, g, b];
}

const BAND_LABELS: Readonly<Record<MixerBand, string>> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  aqua: 'Aqua',
  blue: 'Blue',
  purple: 'Purple',
  magenta: 'Magenta',
};

export function bandLabel(band: MixerBand): string {
  return BAND_LABELS[band];
}

/** "mixer hue+lum" — the channels it touches, as `describeCurves` names a shape. */
export function describeMixer(m: ColourMixer | null | undefined): string | null {
  if (isDefaultMixer(m)) return null;
  const short: Record<MixerChannel, string> = { hue: 'hue', saturation: 'sat', luminance: 'lum' };
  const used = MIXER_CHANNELS.filter((c) => m![c].some((v) => v !== 0)).map((c) => short[c]);
  return `mixer ${used.join('+')}`;
}
