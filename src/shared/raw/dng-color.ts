/**
 * The DNG spec's own camera → XYZ conversion (DNG 1.4, chapter 6, "Mapping
 * Camera Color Space to CIE XYZ Space"), and how far LibRaw's lands from it.
 *
 * LibRaw builds ONE matrix, `rgb_cam`, from ONE `ColorMatrix` — the D65 one
 * where the file has it, whatever the light the picture was taken under, and
 * whatever order the file lists them in — and ignores `ForwardMatrix`
 * (measured on synthetic DNGs, `docs/camera-profiles.md` §2). The spec asks
 * for more:
 *
 * - the white is found from the camera's neutral by ITERATING: a guess, its
 *   temperature, the matrices interpolated at that temperature, a new white;
 * - two calibrations are interpolated LINEARLY IN INVERSE TEMPERATURE between
 *   their illuminants, clamped at both ends;
 * - camera → XYZ D50 is `ForwardMatrix · diag(1 / neutral)` where the file has
 *   forward matrices, else the inverse of `ColorMatrix` adapted to D50 by
 *   Bradford.
 *
 * `dngCorrection` is the 3×3 that would turn LibRaw's decoded picture (linear
 * sRGB, balanced as shot) into the spec's — the same shape as the kelvin
 * white balance's matrix (`white-balance.ts`), so it could ride the develop's
 * head in the same slot. NOTHING applies it yet: putting it on a picture
 * changes the colour of every RAW already developed, which is the
 * maintainer's call (`docs/camera-profiles.md` §6).
 *
 * Pure and DOM-free.
 */

import { illuminantName, type DngCalibration } from '../exif/dng-profile';
import { apply3, inverse3, mul3, tempTintToXy, XYZ_TO_SRGB, xyToTempTint, type RawWhite } from './white-balance';

type M3 = number[];
type V3 = [number, number, number];

const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const diag = (v: readonly number[]): M3 => [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]];
const scale = (m: M3, k: number): M3 => m.map((x) => x * k);
const lerp = (a: M3, b: M3, g: number): M3 => a.map((x, i) => g * x + (1 - g) * b[i]);

/** Linear sRGB (D65) → XYZ, dcraw's `xyz_rgb` — what LibRaw's `rgb_cam` is built against. */
export const SRGB_TO_XYZ: M3 = [0.412453, 0.35758, 0.180423, 0.212671, 0.71516, 0.072169, 0.019334, 0.119193, 0.950227];

/** The profile connection space's white, D50, as the spec and the ICC define it. */
export const D50_XYZ: V3 = [0.9642, 1, 0.8249];
const D50_XY: [number, number] = [0.3457, 0.3585];

const BRADFORD: M3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRADFORD_INV = inverse3(BRADFORD) as M3;

const xyToXyz = (x: number, y: number): V3 => [x / y, 1, (1 - x - y) / y];
const xyzToXy = (v: readonly number[]): [number, number] => {
  const s = v[0] + v[1] + v[2];
  return [v[0] / s, v[1] / s];
};

/** Bradford adaptation from one white (XYZ) to another. */
export function bradford(from: readonly number[], to: readonly number[]): M3 {
  const a = apply3(BRADFORD, from as V3);
  const b = apply3(BRADFORD, to as V3);
  return mul3(BRADFORD_INV, mul3(diag([b[0] / a[0], b[1] / a[1], b[2] / a[2]]), BRADFORD));
}

/**
 * The correlated colour temperature the DNG SDK gives an EXIF LightSource
 * code, or 0 for one it cannot place (then no interpolation happens). The
 * values are the SDK's (`dng_camera_profile.cpp`, `IlluminantToTemperature`)
 * as recalled — not read at source here; Standard light A is 2850 and D65 6500.
 */
export function illuminantKelvin(code: number): number {
  switch (code) {
    case 17: // Standard light A
    case 3: // Tungsten
      return 2850;
    case 24: // ISO studio tungsten
      return 3200;
    case 23: // D50
      return 5000;
    case 20: // D55
    case 1: // Daylight
    case 9: // Fine weather
    case 4: // Flash
    case 18: // Standard light B
      return 5500;
    case 21: // D65
    case 19: // Standard light C
    case 10: // Cloudy
      return 6500;
    case 22: // D75
    case 11: // Shade
      return 7500;
    case 12: // Daylight fluorescent
      return (5700 + 7100) / 2;
    case 13: // Day white fluorescent
      return (4600 + 5500) / 2;
    case 14: // Cool white fluorescent
    case 2: // Fluorescent
      return (3800 + 4500) / 2;
    case 15: // White fluorescent
      return (3250 + 3800) / 2;
    case 16: // Warm white fluorescent
      return (2600 + 3250) / 2;
    default:
      return 0;
  }
}

/**
 * The weight of calibration 1 at `kelvin` (calibration 2 takes the rest):
 * linear in 1/T between the two illuminants' temperatures, clamped at both
 * ends — the spec's rule. `t1` and `t2` in either order; equal or unknown → 1.
 */
export function interpolationWeight(kelvin: number, t1: number, t2: number): number {
  if (!(t1 > 0) || !(t2 > 0) || t1 === t2) return 1;
  const lo = Math.min(t1, t2);
  const hi = Math.max(t1, t2);
  let gLo: number;
  if (kelvin <= lo) gLo = 1;
  else if (kelvin >= hi) gLo = 0;
  else gLo = (1 / kelvin - 1 / hi) / (1 / lo - 1 / hi);
  return t1 < t2 ? gLo : 1 - gLo;
}

/** The calibration's matrices at a temperature: interpolated where there are two, the one otherwise. */
export interface ProfileAt {
  /** XYZ → camera, `AnalogBalance · CameraCalibration · ColorMatrix`. */
  xyzToCamera: M3;
  /** `AnalogBalance · CameraCalibration`, the part a forward matrix is undone through. */
  calibration: M3;
  forwardMatrix: M3 | null;
}

/** The calibrations usable for colour: those with a colour matrix. */
function usable(cals: readonly DngCalibration[]): DngCalibration[] {
  return cals.filter((c) => c.colorMatrix);
}

export function profileAt(
  cals: readonly DngCalibration[],
  kelvin: number,
  analogBalance: readonly number[] | null = null,
): ProfileAt | null {
  const list = usable(cals);
  if (!list.length) return null;
  const [c1, c2] = list;
  const g = c2 ? interpolationWeight(kelvin, illuminantKelvin(c1.illuminant), illuminantKelvin(c2.illuminant)) : 1;
  const pick = (a: M3 | null, b: M3 | null | undefined): M3 | null => {
    if (!c2) return a;
    if (a && b) return lerp(a, b, g);
    // One side missing: the spec takes the one there is.
    return a ?? b ?? null;
  };
  const cm = pick(c1.colorMatrix, c2?.colorMatrix) as M3;
  const cc = pick(c1.cameraCalibration, c2?.cameraCalibration) ?? IDENTITY;
  const fm = c2 && !!c1.forwardMatrix !== !!c2.forwardMatrix ? null : pick(c1.forwardMatrix, c2?.forwardMatrix);
  const ab = analogBalance ? diag(analogBalance) : IDENTITY;
  const calibration = mul3(ab, cc);
  return { xyzToCamera: mul3(calibration, cm), calibration, forwardMatrix: fm };
}

/**
 * The white a camera neutral stands for, as CIE xy — the SDK's
 * `NeutralToXY`: start at D50, interpolate at the guess's temperature, invert,
 * repeat until it moves less than 1e-7 (30 passes at most, the last two
 * averaged).
 */
export function neutralToXy(
  cals: readonly DngCalibration[],
  neutral: readonly number[],
  analogBalance: readonly number[] | null = null,
): [number, number] | null {
  let last: [number, number] = D50_XY;
  for (let pass = 0; pass < 30; pass += 1) {
    const at = profileAt(cals, xyToTempTint(last[0], last[1]).kelvin, analogBalance);
    const inv = at && inverse3(at.xyzToCamera);
    if (!inv) return null;
    const xyz = apply3(inv, neutral as V3);
    if (!(xyz[0] + xyz[1] + xyz[2] > 0) || !(xyz[1] > 0)) return null;
    const next = xyzToXy(xyz);
    if (Math.abs(next[0] - last[0]) + Math.abs(next[1] - last[1]) < 1e-7) return next;
    if (pass === 29) return [(last[0] + next[0]) / 2, (last[1] + next[1]) / 2];
    last = next;
  }
  return last;
}

/**
 * Camera → XYZ D50 for a picture whose neutral is `neutral` — the spec's two
 * paths. Maps the neutral to D50 white with Y = 1.
 */
export function cameraToXyzD50(
  cals: readonly DngCalibration[],
  neutral: readonly number[],
  analogBalance: readonly number[] | null = null,
): M3 | null {
  const white = neutralToXy(cals, neutral, analogBalance);
  if (!white) return null;
  const at = profileAt(cals, xyToTempTint(white[0], white[1]).kelvin, analogBalance);
  if (!at) return null;
  const calInv = inverse3(at.calibration);
  if (!calInv) return null;
  if (at.forwardMatrix) {
    // The SDK normalises a forward matrix so camera (1,1,1) lands on D50.
    const one = apply3(at.forwardMatrix, [1, 1, 1]);
    if (!one.every((v) => v > 0)) return null;
    const fm = mul3(diag([D50_XYZ[0] / one[0], D50_XYZ[1] / one[1], D50_XYZ[2] / one[2]]), at.forwardMatrix);
    const ref = apply3(calInv, neutral as V3);
    if (!ref.every((v) => v > 0)) return null;
    return mul3(fm, mul3(diag([1 / ref[0], 1 / ref[1], 1 / ref[2]]), calInv));
  }
  const inv = inverse3(at.xyzToCamera);
  if (!inv) return null;
  const m = mul3(bradford(xyToXyz(white[0], white[1]), D50_XYZ), inv);
  const y = apply3(m, neutral as V3)[1];
  return y > 0 ? scale(m, 1 / y) : null;
}

/**
 * White-balanced camera RGB (the neutral at (1,1,1), LibRaw's own space
 * before `rgb_cam`) → linear sRGB D65, (1,1,1) → (1,1,1) — the spec's answer.
 */
export function balancedToSrgb(
  cals: readonly DngCalibration[],
  neutral: readonly number[],
  analogBalance: readonly number[] | null = null,
): M3 | null {
  const toD50 = cameraToXyzD50(cals, neutral, analogBalance);
  if (!toD50) return null;
  const D65 = apply3(SRGB_TO_XYZ, [1, 1, 1]);
  const m = mul3(XYZ_TO_SRGB, mul3(bradford(D50_XYZ, D65), mul3(toD50, diag(neutral))));
  const w = apply3(m, [1, 1, 1]);
  return w.every((v) => v > 0) ? mul3(diag([1 / w[0], 1 / w[1], 1 / w[2]]), m) : null;
}

/**
 * dcraw's `cam_xyz_coeff`: `rgb_cam = inverse(rows-normalised(ColorMatrix · xyz_rgb))`
 * — what LibRaw decodes a DNG with, from the ONE matrix it picks.
 */
export function dcrawRgbCam(colorMatrix: readonly number[]): M3 | null {
  const camRgb = mul3(colorMatrix as M3, SRGB_TO_XYZ);
  for (let r = 0; r < 3; r += 1) {
    const sum = camRgb[r * 3] + camRgb[r * 3 + 1] + camRgb[r * 3 + 2];
    if (!(Math.abs(sum) > 1e-9)) return null;
    for (let c = 0; c < 3; c += 1) camRgb[r * 3 + c] /= sum;
  }
  return inverse3(camRgb);
}

/**
 * The matrix LibRaw picks out of a DNG's calibrations — the D65 one where
 * there is one, else the LAST, measured (`docs/camera-profiles.md` §2).
 */
export function librawPick(cals: readonly DngCalibration[]): DngCalibration | null {
  const list = usable(cals);
  return list.find((c) => c.illuminant === 21) ?? list[list.length - 1] ?? null;
}

/**
 * The 3×3, in the decoded picture's own space (linear sRGB, balanced as
 * shot), that turns LibRaw's conversion into the spec's: `balancedToSrgb ·
 * rgbCam⁻¹`. Identity where the two agree — a single D65 matrix and a neutral
 * shot under D65. Null where the file's data cannot say.
 */
export function dngCorrection(
  cals: readonly DngCalibration[],
  neutral: readonly number[],
  rgbCam: readonly number[],
  analogBalance: readonly number[] | null = null,
): M3 | null {
  const spec = balancedToSrgb(cals, neutral, analogBalance);
  const inv = inverse3(rgbCam as M3);
  return spec && inv ? mul3(spec, inv) : null;
}

/**
 * LibRaw's `color_data.dng_color` (libraw-wasm 1.6's full read: two slots of
 * `{ illuminant, colormatrix 4×3, forwardmatrix 3×4, calibration 4×4 }`, all
 * zeros where the file has nothing — measured) as calibrations.
 */
export function calibrationsFromLibraw(dngColor: unknown): DngCalibration[] {
  if (!Array.isArray(dngColor)) return [];
  const m3 = (v: unknown): number[] | null => {
    if (!Array.isArray(v) || v.length < 3) return null;
    const out: number[] = [];
    for (let r = 0; r < 3; r += 1) {
      const row = v[r];
      if (!Array.isArray(row) || row.length < 3) return null;
      for (let c = 0; c < 3; c += 1) {
        const n = row[c];
        if (typeof n !== 'number' || !Number.isFinite(n)) return null;
        out.push(n);
      }
    }
    return out.every((n) => n === 0) ? null : out;
  };
  const out: DngCalibration[] = [];
  for (const slot of dngColor) {
    if (!slot || typeof slot !== 'object') continue;
    const s = slot as Record<string, unknown>;
    const colorMatrix = m3(s.colormatrix);
    const forwardMatrix = m3(s.forwardmatrix);
    if (!colorMatrix && !forwardMatrix) continue;
    out.push({
      illuminant: typeof s.illuminant === 'number' ? s.illuminant : 0,
      colorMatrix,
      forwardMatrix,
      cameraCalibration: m3(s.calibration),
    });
  }
  return out;
}

// --- On a picture -------------------------------------------------------------

/**
 * The camera's colour AS THE DNG SPEC MEANS IT, resolved for ONE picture and
 * stored on its develop (`DevelopSettings.rawProfile`): the 3×3 from LibRaw's
 * decode to the spec's at the as-shot white (`dngCorrection`), and which
 * calibrations it came from. Stored like the gain — preview = export, and a
 * later decoder never moves a developed picture. Absent: LibRaw's colour,
 * which is every picture developed before 2026-10-07 (his Q1: stored
 * pictures do not move).
 */
export interface RawProfile {
  matrix: number[];
  /** `A + D65`, `D65` — the calibrations it interpolated, for the picture's facts. */
  label: string;
}

/** The calibrations a white carries, or LibRaw's one matrix taken as D65's. */
export function calibrationsOf(white: RawWhite): DngCalibration[] {
  const own = white.calibrations?.filter((c) => c.colorMatrix) ?? [];
  if (own.length) return own;
  return [{ illuminant: 21, colorMatrix: white.camXyz, forwardMatrix: null, cameraCalibration: null }];
}

/** The as-shot neutral in camera space: `1 / multiplier`. */
function neutralOf(white: RawWhite): V3 {
  return [1 / white.asShot[0], 1 / white.asShot[1], 1 / white.asShot[2]];
}

/** The profile for one decoded picture, or null where its data cannot say. */
export function rawProfileFor(white: RawWhite | null | undefined): RawProfile | null {
  if (!white) return null;
  const cals = calibrationsOf(white);
  const matrix = dngCorrection(cals, neutralOf(white), white.rgbCam);
  if (!matrix || !matrix.every((v) => Number.isFinite(v))) return null;
  return { matrix, label: cals.map((c) => illuminantName(c.illuminant)).join(' + ') };
}

/**
 * Resolve the profile at the picture's next metering — the stage's decode or
 * the run's, whichever comes first, as for a gain stored as null. What a
 * picture newly put on its sensor carries until then.
 */
export const PROFILE_PENDING = 'pending';

/**
 * What a decoder is asked to fold into the camera's matrix (C4): a profile
 * already stored on the picture (its matrix), `'resolve'` to work it out from
 * this very decode's own colour data, or nothing — LibRaw's colour.
 */
export type ProfileRequest = readonly number[] | 'resolve' | null | undefined;

/** The profile a request comes to for a decode whose white is `white`, or null. */
export function resolveProfile(request: ProfileRequest, white: RawWhite | null | undefined): RawProfile | null {
  if (!request) return null;
  if (request === 'resolve') return rawProfileFor(white);
  return request.length === 9 && request.every((v) => Number.isFinite(v)) ? { matrix: [...request], label: '' } : null;
}

/** A stored profile read back safely: nine finite numbers, the pending mark, or null. */
export function rawProfileOrNull(raw: unknown): RawProfile | typeof PROFILE_PENDING | null {
  if (raw === PROFILE_PENDING) return PROFILE_PENDING;
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const m = src.matrix;
  if (!Array.isArray(m) || m.length !== 9 || !m.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return { matrix: [...(m as number[])], label: typeof src.label === 'string' ? src.label.slice(0, 40) : '' };
}

/**
 * The as-shot temperature and tint the SPEC reads — the white found through
 * the interpolated matrices (`neutralToXy`), not through LibRaw's D65 one.
 */
export function profiledAsShot(white: RawWhite): { kelvin: number; tint: number } | null {
  const xy = neutralToXy(calibrationsOf(white), neutralOf(white));
  return xy ? xyToTempTint(xy[0], xy[1]) : null;
}

/**
 * The white balance in kelvin on a PROFILED picture: the one 3×3 from the
 * decoded picture (LibRaw's, balanced as shot) to the spec's rendering under
 * the light asked for — `balancedToSrgb(n') · diag(n / n') · rgbCam⁻¹`, `n'`
 * the camera's neutral under that light through the matrices interpolated at
 * its temperature. At the as-shot light it IS the profile's matrix, so the
 * kelvin panel replaces the profile's matrix rather than stacking on it.
 */
export function profiledWbMatrix(white: RawWhite, kelvin: number, tint: number): number[] | null {
  const cals = calibrationsOf(white);
  const at = profileAt(cals, kelvin);
  if (!at) return null;
  const [x, y] = tempTintToXy(kelvin, tint);
  const raw = apply3(at.xyzToCamera, xyToXyz(x, y));
  if (!raw.every((v) => v > 0)) return null;
  const shot = neutralOf(white);
  // Green held where it was, as `wbMatrix`'s multipliers are: a new light
  // re-balances red and blue against green, it does not re-expose.
  const next: V3 = [(raw[0] * shot[1]) / raw[1], shot[1], (raw[2] * shot[1]) / raw[1]];
  const spec = balancedToSrgb(cals, next);
  const inv = inverse3(white.rgbCam);
  if (!spec || !inv) return null;
  return mul3(spec, mul3(diag([shot[0] / next[0], shot[1] / next[1], shot[2] / next[2]]), inv));
}
