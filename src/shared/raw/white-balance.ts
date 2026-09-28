/**
 * WHITE BALANCE IN KELVIN on a RAW (audit item 17, `docs/lightroom-gaps.md`).
 *
 * Kelvin was cut from the 8-bit develop as a fabrication: a finished JPEG has
 * no as-shot white balance to move from, and a temperature there is only a
 * pair of gains (`develop.md`). A RAW has one — LibRaw decodes it with the
 * camera's own multipliers (`cam_mul`) and converts it with the camera's own
 * matrices (`cam_xyz`, `rgb_cam`) — so here a temperature MEANS something:
 *
 * - The as-shot white is read back to a chromaticity through the camera's
 *   matrix, and named as a temperature and a tint (`asShotTempTint`).
 * - A temperature and tint the author picks are turned into the multipliers
 *   the camera WOULD have used under that light (`multipliersFor`).
 * - The decoded picture, already balanced as shot and in linear sRGB, is
 *   re-balanced by ONE 3×3 matrix: `rgb_cam · diag(new / as shot) · rgb_cam⁻¹`
 *   — what LibRaw would have produced with those multipliers, without a
 *   second decode (`wbMatrix`).
 *
 * Temperature and tint follow Lightroom's reading: the Planckian locus in
 * CIE 1960 uv, and a tint the LIGHT's offset along its normal, 3000 per unit
 * of Duv — a positive tint is a light greener than a black body (daylight
 * sits there: Lightroom's Daylight is 5500 K, +10), which the correction
 * answers with magenta, so the slider moves the picture the way Lightroom's
 * does: + toward magenta, − toward green; lower Kelvin, bluer.
 *
 * Pure and DOM-free.
 */

/** What the decoder knows about a RAW's white: row-major 3×3 matrices, multipliers normalised on green. */
export interface RawWhite {
  /** The camera's as-shot multipliers, R G B, G = 1. */
  asShot: [number, number, number];
  /** XYZ → camera, 3×3 row-major (LibRaw's `cam_xyz`, the colour rows). */
  camXyz: number[];
  /** Camera → linear sRGB, 3×3 row-major (LibRaw's `rgb_cam`, the colour columns). */
  rgbCam: number[];
}

/** A white balance stored on a develop: what was asked, and the matrix it came to for THIS picture. */
export interface RawWhiteBalance {
  kelvin: number;
  tint: number;
  /** Linear sRGB → linear sRGB, 3×3 row-major — stored so the export applies exactly what the stage did. */
  matrix: number[];
}

export const KELVIN_RANGE = { min: 2000, max: 50000 } as const;
export const TINT_RANGE = { min: -150, max: 150 } as const;

/** Lightroom's presets, in its order. */
export const WB_PRESETS: readonly { id: string; label: string; kelvin: number; tint: number }[] = [
  { id: 'daylight', label: 'Daylight', kelvin: 5500, tint: 10 },
  { id: 'cloudy', label: 'Cloudy', kelvin: 6500, tint: 10 },
  { id: 'shade', label: 'Shade', kelvin: 7500, tint: 10 },
  { id: 'tungsten', label: 'Tungsten', kelvin: 2850, tint: 0 },
  { id: 'fluorescent', label: 'Fluorescent', kelvin: 3800, tint: 21 },
  { id: 'flash', label: 'Flash', kelvin: 5500, tint: 0 },
];

// --- 3×3 algebra ------------------------------------------------------------

type M3 = number[];

export function mul3(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}

export function apply3(m: M3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function inverse3(m: M3): M3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

// --- the Planckian locus ----------------------------------------------------

const xyToUv = (x: number, y: number): [number, number] => {
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
};
const uvToXy = (u: number, v: number): [number, number] => {
  const d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
};

/**
 * CIE 1960 uv of a black body at `kelvin` — Krystek's rational fit (1985),
 * within 1e-4 of the true locus from 1000 to 15000 K and SMOOTH everywhere,
 * which a nearest-point search needs: the piecewise cubic of Kim et al. has a
 * kink at 4000 K that threw a round trip 8 K off there.
 */
export function planckianUv(kelvin: number): [number, number] {
  const T = Math.max(1000, Math.min(KELVIN_RANGE.max, kelvin));
  const u = (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T);
  const v = (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T);
  return [u, v];
}

/** CIE 1931 xy of a black body at `kelvin`. */
export function planckianXy(kelvin: number): [number, number] {
  return uvToXy(...planckianUv(kelvin));
}

/** The locus in uv at `kelvin`, and its unit normal (toward positive Duv, green). */
function locusFrame(kelvin: number): { uv: [number, number]; normal: [number, number] } {
  const uv = planckianUv(kelvin);
  const next = planckianUv(kelvin * 1.001);
  const tx = next[0] - uv[0];
  const ty = next[1] - uv[1];
  const len = Math.hypot(tx, ty) || 1;
  // Rotate the tangent (toward cooler) a quarter-turn so the normal points up in v — toward green.
  let nx = -ty / len;
  let ny = tx / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { uv, normal: [nx, ny] };
}

/** 3000 tint per unit of Duv, positive toward green — Lightroom's scale. */
const TINT_SCALE = 3000;

/** A temperature and tint as a CIE 1931 chromaticity. */
export function tempTintToXy(kelvin: number, tint: number): [number, number] {
  const { uv, normal } = locusFrame(kelvin);
  const duv = tint / TINT_SCALE;
  return uvToXy(uv[0] + normal[0] * duv, uv[1] + normal[1] * duv);
}

/** A chromaticity named as the nearest temperature on the locus and its tint off it. */
export function xyToTempTint(x: number, y: number): { kelvin: number; tint: number } {
  const [u, v] = xyToUv(x, y);
  // In mireds the locus is walked evenly: a coarse sweep, then a golden refinement.
  const dist = (mired: number) => {
    const { uv } = locusFrame(1e6 / mired);
    return Math.hypot(u - uv[0], v - uv[1]);
  };
  let best = 20;
  for (let m = 20; m <= 600; m += 2) if (dist(m) < dist(best)) best = m;
  let lo = Math.max(20, best - 2);
  let hi = Math.min(600, best + 2);
  for (let i = 0; i < 60; i++) {
    const a = lo + (hi - lo) * 0.382;
    const b = lo + (hi - lo) * 0.618;
    if (dist(a) < dist(b)) hi = b;
    else lo = a;
  }
  const kelvin = 1e6 / ((lo + hi) / 2);
  const { uv, normal } = locusFrame(kelvin);
  const duv = (u - uv[0]) * normal[0] + (v - uv[1]) * normal[1];
  return { kelvin, tint: duv * TINT_SCALE };
}

// --- the camera -------------------------------------------------------------

/** XYZ of a chromaticity at Y = 1. */
function xyToXyz(x: number, y: number): [number, number, number] {
  return [x / y, 1, (1 - x - y) / y];
}

/** The multipliers the camera would use under this light: 1 / its neutral, normalised on green. */
export function multipliersFor(white: RawWhite, kelvin: number, tint: number): [number, number, number] | null {
  const n = apply3(white.camXyz, xyToXyz(...tempTintToXy(kelvin, tint)));
  if (n.some((c) => !(c > 0))) return null;
  return [n[1] / n[0], 1, n[1] / n[2]];
}

/** The temperature and tint the camera shot at, read back through its matrix. */
export function asShotTempTint(white: RawWhite): { kelvin: number; tint: number } | null {
  const inv = inverse3(white.camXyz);
  if (!inv) return null;
  const neutral: [number, number, number] = [1 / white.asShot[0], 1 / white.asShot[1], 1 / white.asShot[2]];
  const [X, Y, Z] = apply3(inv, neutral);
  const s = X + Y + Z;
  if (!(s > 0) || !(Y > 0)) return null;
  return xyToTempTint(X / s, Y / s);
}

/**
 * The matrix that re-balances the decoded picture (linear sRGB, balanced as
 * shot) to `kelvin` / `tint` — or null when the camera's data cannot say
 * (a matrix that does not invert, a neutral off the camera's gamut).
 */
export function wbMatrix(white: RawWhite, kelvin: number, tint: number): number[] | null {
  const m = multipliersFor(white, kelvin, tint);
  const inv = inverse3(white.rgbCam);
  if (!m || !inv) return null;
  const ratio = [m[0] / white.asShot[0], m[1] / white.asShot[1], m[2] / white.asShot[2]];
  const diag = [ratio[0], 0, 0, 0, ratio[1], 0, 0, 0, ratio[2]];
  return mul3(white.rgbCam, mul3(diag, inv));
}

/** A white balance read back safely — or null: a matrix of nine finite numbers, the rest clamped. */
export function rawWhiteBalanceOrNull(raw: unknown): RawWhiteBalance | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const m = src.matrix;
  if (!Array.isArray(m) || m.length !== 9 || !m.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const k = typeof src.kelvin === 'number' && Number.isFinite(src.kelvin) ? src.kelvin : null;
  const t = typeof src.tint === 'number' && Number.isFinite(src.tint) ? src.tint : 0;
  if (k === null) return null;
  return {
    kelvin: Math.max(KELVIN_RANGE.min, Math.min(KELVIN_RANGE.max, k)),
    tint: Math.max(TINT_RANGE.min, Math.min(TINT_RANGE.max, t)),
    matrix: [...(m as number[])],
  };
}

/** Linear sRGB (D65) → XYZ — dcraw's `xyz_rgb`, inverted; what LibRaw's `rgb_cam` was built against. */
const XYZ_TO_SRGB = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252];

/**
 * Is the decoder's read usable: finite, a camera matrix that inverts,
 * positive multipliers.
 *
 * `cam_xyz` is LibRaw's XYZ → camera matrix for the bodies it knows — and all
 * ZEROS for a DNG, whose matrix LibRaw keeps elsewhere (measured on a
 * synthetic DNG). It is then recovered from what LibRaw built out of it:
 * `rgb_cam` is the inverse of `cam_xyz · xyz_rgb` with its rows normalised by
 * `pre_mul`, so `cam_xyz = diag(1 / pre_mul) · rgb_cam⁻¹ · XYZ→sRGB` — the
 * same matrix up to a common scale, which a chromaticity does not see.
 */
export function rawWhiteOrNull(raw: {
  camMul?: unknown;
  camXyz?: unknown;
  rgbCam?: unknown;
  preMul?: unknown;
}): RawWhite | null {
  const rows = (v: unknown, r: number, c: number): number[] | null => {
    if (!Array.isArray(v) || v.length < r) return null;
    const out: number[] = [];
    for (let i = 0; i < r; i++) {
      const row = v[i];
      if (!Array.isArray(row) || row.length < c) return null;
      for (let j = 0; j < c; j++) {
        const n = row[j];
        if (typeof n !== 'number' || !Number.isFinite(n)) return null;
        out.push(n);
      }
    }
    return out;
  };
  const mul = Array.isArray(raw.camMul) ? (raw.camMul as unknown[]).map(Number) : null;
  const rgbCam = rows(raw.rgbCam, 3, 3);
  let camXyz = rows(raw.camXyz, 3, 3);
  if (camXyz && camXyz.every((n) => n === 0)) camXyz = null;
  if (!camXyz && rgbCam) {
    const pre = Array.isArray(raw.preMul) ? (raw.preMul as unknown[]).map(Number) : null;
    const camRgbNorm = inverse3(rgbCam);
    if (pre && pre.length >= 3 && pre.slice(0, 3).every((p) => p > 0) && camRgbNorm) {
      const unscale = [1 / pre[0], 0, 0, 0, 1 / pre[1], 0, 0, 0, 1 / pre[2]];
      camXyz = mul3(mul3(unscale, camRgbNorm), XYZ_TO_SRGB);
    }
  }
  if (!mul || mul.length < 3 || !camXyz || !rgbCam) return null;
  const g = mul[3] > 0 ? (mul[1] + mul[3]) / 2 : mul[1];
  if (!(mul[0] > 0) || !(g > 0) || !(mul[2] > 0)) return null;
  if (!inverse3(camXyz) || !inverse3(rgbCam)) return null;
  return { asShot: [mul[0] / g, 1, mul[2] / g], camXyz, rgbCam };
}

/** `5600 K, tint +8`. */
export function describeWhiteBalance(wb: RawWhiteBalance): string {
  const t = Math.round(wb.tint);
  return `${Math.round(wb.kelvin)} K${t ? `, tint ${t > 0 ? '+' : '−'}${Math.abs(t)}` : ''}`;
}
