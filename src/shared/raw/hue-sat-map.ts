/**
 * A DNG profile's HUE/SATURATION MAP (`ProfileHueSatMap`, DNG 1.4 ch. 6):
 * a table of hue shifts and saturation and value scales, indexed by hue,
 * saturation and (in a 3D table) value, applied in linear ProPhoto RGB right
 * after the camera's matrix — what turns a plain matrix into, say, Adobe
 * Standard. C5 of `docs/camera-profiles.md`.
 *
 * It is applied by the DECODER, beside the matrix and before the clip
 * (`raw-image.ts` `applyCameraMatrix`, `linear-dng.ts` `developTile`), at
 * the picture's as-shot white — the order the DNG SDK renders in. The two
 * illuminants' tables are blended with the matrices' own weight, resolved
 * once and stored on the picture (`RawProfile.hueSat`); the table itself is
 * read from the file each time, like the opcode lists.
 *
 * The arithmetic is the DNG SDK's `RefBaselineHueSatMap` and its HSV, AS
 * RECALLED and not read at source — checked here against its own
 * invariants (an identity table changes nothing, a hue shift of 60° moves a
 * primary one sextant, a table entry is hit exactly at its node).
 *
 * Pure and DOM-free.
 */

import type { DngHsvTable } from '../exif/dng-profile';
import { apply3, inverse3, mul3 } from './white-balance';

/** One table, both illuminants already blended: `dims` = hue · saturation · value divisions. */
export interface HueSatTable {
  dims: [number, number, number];
  /** `dims` product × 3 floats: hue shift (degrees), saturation scale, value scale. Value-major, then hue, then saturation. */
  data: Float32Array;
  /** The value axis is sRGB-encoded (`ProfileHueSatMapEncoding` 1). */
  srgbValue: boolean;
}

/**
 * The file's map blended at `weight` (of calibration 1 — the matrices'
 * `interpolationWeight`), or null when the file's bytes are not in hand.
 */
export function blendHueSat(map: DngHsvTable | null | undefined, weight: number): HueSatTable | null {
  if (!map?.data) return null;
  const g = Math.max(0, Math.min(1, weight));
  if (!map.data2 || g >= 1) return { dims: map.dims, data: map.data, srgbValue: map.srgbValue };
  const data = new Float32Array(map.data.length);
  for (let i = 0; i < data.length; i += 1) data[i] = g * map.data[i] + (1 - g) * map.data2[i];
  return { dims: map.dims, data, srgbValue: map.srgbValue };
}

// --- Linear sRGB (D65) ↔ linear ProPhoto (D50) --------------------------------

const SRGB_TO_XYZ = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
const PROPHOTO_TO_XYZ = [0.7976749, 0.1351917, 0.0313534, 0.2880402, 0.7118741, 0.0000857, 0, 0, 0.82521];
const BRADFORD_D65_TO_D50 = [1.0478112, 0.0228866, -0.050127, 0.0295424, 0.9904844, -0.0170491, -0.0092345, 0.0150436, 0.7521316];

/** Linear sRGB → linear ProPhoto RGB, white to white. */
export const SRGB_TO_PROPHOTO = mul3(inverse3(PROPHOTO_TO_XYZ)!, mul3(BRADFORD_D65_TO_D50, SRGB_TO_XYZ));
/** Linear ProPhoto RGB → linear sRGB. */
export const PROPHOTO_TO_SRGB = inverse3(SRGB_TO_PROPHOTO)!;

// --- The SDK's HSV --------------------------------------------------------------

/** RGB → hue in [0, 6), saturation, value (the maximum) — `DNG_RGBtoHSV`. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const v = Math.max(r, g, b);
  const gap = v - Math.min(r, g, b);
  if (!(gap > 0)) return [0, 0, v];
  let h: number;
  if (r === v) {
    h = (g - b) / gap;
    if (h < 0) h += 6;
  } else if (g === v) h = 2 + (b - r) / gap;
  else h = 4 + (r - g) / gap;
  return [h, gap / v, v];
}

/** Hue in [0, 6), saturation, value → RGB — `DNG_HSVtoRGB`. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  if (!(s > 0)) return [v, v, v];
  let hh = h % 6;
  if (hh < 0) hh += 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

const srgbEncode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/**
 * One linear ProPhoto pixel through the table: hue wraps, saturation and
 * value are clamped to the table's range, the three channels interpolated
 * (bilinear in hue × saturation, trilinear with a value axis); the hue
 * shifted, saturation scaled and held at 1, value scaled.
 */
export function mapHsv(table: HueSatTable, r: number, g: number, b: number): [number, number, number] {
  const [hueDiv, satDiv, valDiv] = table.dims;
  const [h, s, v] = rgbToHsv(Math.max(0, r), Math.max(0, g), Math.max(0, b));
  const data = table.data;
  const hueStep = satDiv;
  const valStep = hueDiv * satDiv;

  const hScaled = (h * hueDiv) / 6;
  let h0 = Math.floor(hScaled);
  const hf = hScaled - h0;
  if (h0 >= hueDiv) h0 -= hueDiv;
  const h1 = h0 + 1 >= hueDiv ? 0 : h0 + 1;

  const sScaled = Math.min(satDiv - 1, s * (satDiv - 1));
  const s0 = Math.min(satDiv - 2, Math.max(0, Math.floor(sScaled)));
  const sf = sScaled - s0;

  let v0 = 0;
  let vf = 0;
  if (valDiv > 1) {
    const vIn = table.srgbValue ? srgbEncode(Math.min(1, v)) : Math.min(1, v);
    const vScaled = vIn * (valDiv - 1);
    v0 = Math.min(valDiv - 2, Math.max(0, Math.floor(vScaled)));
    vf = vScaled - v0;
  }

  let hueShift = 0;
  let satScale = 0;
  let valScale = 0;
  const layers = valDiv > 1 ? 2 : 1;
  for (let dv = 0; dv < layers; dv += 1) {
    const wv = layers === 1 ? 1 : dv ? vf : 1 - vf;
    for (let dh = 0; dh < 2; dh += 1) {
      const wh = dh ? hf : 1 - hf;
      const hi = dh ? h1 : h0;
      for (let ds = 0; ds < 2; ds += 1) {
        const w = wv * wh * (ds ? sf : 1 - sf);
        if (w === 0) continue;
        const o = ((v0 + dv) * valStep + hi * hueStep + s0 + ds) * 3;
        hueShift += w * data[o];
        satScale += w * data[o + 1];
        valScale += w * data[o + 2];
      }
    }
  }
  return hsvToRgb(h + (hueShift * 6) / 360, Math.min(1, s * satScale), v * valScale);
}

/**
 * The table compiled for a hot loop: `map(io)` takes one linear ProPhoto
 * pixel in `io[0..2]` and writes it back mapped — `mapHsv`'s arithmetic to
 * the last bit, with no array made per pixel (a 12 MP plane is twelve
 * million calls). Null for a table that changes nothing, so a caller skips
 * the conversions too.
 */
export function compileHueSat(table: HueSatTable): ((io: Float64Array) => void) | null {
  if (isIdentityHueSat(table)) return null;
  const [hueDiv, satDiv, valDiv] = table.dims;
  const data = table.data;
  const hueStep = satDiv;
  const valStep = hueDiv * satDiv;
  const hueScale = hueDiv / 6;
  const satMax = satDiv - 1;
  const valMax = valDiv - 1;
  const layered = valDiv > 1;
  const srgbValue = table.srgbValue;
  return (io) => {
    const r = io[0] > 0 ? io[0] : 0;
    const g = io[1] > 0 ? io[1] : 0;
    const b = io[2] > 0 ? io[2] : 0;
    const v = r > g ? (r > b ? r : b) : g > b ? g : b;
    const gap = v - (r < g ? (r < b ? r : b) : g < b ? g : b);
    // A grey (or black) has no hue: the SDK still scales its value, by the
    // table's entry at hue 0, saturation 0.
    let h = 0;
    let s = 0;
    if (gap > 0) {
      if (r === v) {
        h = (g - b) / gap;
        if (h < 0) h += 6;
      } else if (g === v) h = 2 + (b - r) / gap;
      else h = 4 + (r - g) / gap;
      s = gap / v;
    }

    const hScaled = h * hueScale;
    let h0 = Math.floor(hScaled);
    const hf = hScaled - h0;
    if (h0 >= hueDiv) h0 -= hueDiv;
    const h1 = h0 + 1 >= hueDiv ? 0 : h0 + 1;
    const sScaled = Math.min(satMax, s * satMax);
    const s0 = Math.min(satDiv - 2, Math.max(0, Math.floor(sScaled)));
    const sf = sScaled - s0;

    let o00 = h0 * hueStep + s0;
    let o10 = h1 * hueStep + s0;
    let vf = 0;
    if (layered) {
      const vIn = srgbValue ? srgbEncode(v < 1 ? v : 1) : v < 1 ? v : 1;
      const vScaled = vIn * valMax;
      const v0 = Math.min(valDiv - 2, Math.max(0, Math.floor(vScaled)));
      vf = vScaled - v0;
      o00 += v0 * valStep;
      o10 += v0 * valStep;
    }
    const w00 = (1 - hf) * (1 - sf);
    const w01 = (1 - hf) * sf;
    const w10 = hf * (1 - sf);
    const w11 = hf * sf;
    let a = o00 * 3;
    let c = o10 * 3;
    let hueShift = w00 * data[a] + w01 * data[a + 3] + w10 * data[c] + w11 * data[c + 3];
    let satScale = w00 * data[a + 1] + w01 * data[a + 4] + w10 * data[c + 1] + w11 * data[c + 4];
    let valScale = w00 * data[a + 2] + w01 * data[a + 5] + w10 * data[c + 2] + w11 * data[c + 5];
    if (layered) {
      a += valStep * 3;
      c += valStep * 3;
      const u = 1 - vf;
      hueShift = u * hueShift + vf * (w00 * data[a] + w01 * data[a + 3] + w10 * data[c] + w11 * data[c + 3]);
      satScale = u * satScale + vf * (w00 * data[a + 1] + w01 * data[a + 4] + w10 * data[c + 1] + w11 * data[c + 4]);
      valScale = u * valScale + vf * (w00 * data[a + 2] + w01 * data[a + 5] + w10 * data[c + 2] + w11 * data[c + 5]);
    }

    // hsvToRgb, inline.
    const vv = v * valScale;
    const ss = Math.min(1, s * satScale);
    if (!(ss > 0)) {
      io[0] = io[1] = io[2] = vv;
      return;
    }
    let hh = (h + hueShift / 60) % 6;
    if (hh < 0) hh += 6;
    const i = Math.floor(hh);
    const f = hh - i;
    const p = vv * (1 - ss);
    const q = vv * (1 - ss * f);
    const t = vv * (1 - ss * (1 - f));
    switch (i) {
      case 0:
        io[0] = vv;
        io[1] = t;
        io[2] = p;
        break;
      case 1:
        io[0] = q;
        io[1] = vv;
        io[2] = p;
        break;
      case 2:
        io[0] = p;
        io[1] = vv;
        io[2] = t;
        break;
      case 3:
        io[0] = p;
        io[1] = q;
        io[2] = vv;
        break;
      case 4:
        io[0] = t;
        io[1] = p;
        io[2] = vv;
        break;
      default:
        io[0] = vv;
        io[1] = p;
        io[2] = q;
    }
  };
}

const compiled = new WeakMap<HueSatTable, ((io: Float64Array) => void) | null>();

/** `compileHueSat`, once per table — a plane is converted a band at a time. */
export function compiledHueSat(table: HueSatTable): ((io: Float64Array) => void) | null {
  let fn = compiled.get(table);
  if (fn === undefined) compiled.set(table, (fn = compileHueSat(table)));
  return fn;
}

/** One linear sRGB pixel through the table, by way of linear ProPhoto. */
export function mapSrgbThroughHueSat(table: HueSatTable, rgb: readonly [number, number, number]): [number, number, number] {
  const pro = apply3(SRGB_TO_PROPHOTO, rgb as [number, number, number]);
  return apply3(PROPHOTO_TO_SRGB, mapHsv(table, pro[0], pro[1], pro[2]));
}

/** Whether a table changes nothing — every hue shift 0, every scale 1. */
export function isIdentityHueSat(table: HueSatTable): boolean {
  const d = table.data;
  for (let i = 0; i < d.length; i += 3) if (d[i] !== 0 || d[i + 1] !== 1 || d[i + 2] !== 1) return false;
  return true;
}
