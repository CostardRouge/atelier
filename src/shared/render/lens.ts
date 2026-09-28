/**
 * LENS CORRECTION — the barrel a wide lens bends into straight walls, the
 * colour fringes it leaves at the corners, and the light it loses there.
 *
 * All three are RADIAL: they depend only on how far a pixel is from the centre.
 * That is what lets one pass carry the lot — the sample position, the per-channel
 * scale and the brightness gain are three uses of the same radius — and it is
 * why they live in one record rather than three.
 *
 * The model is Brown–Conrady's, the one Lensfun and every RAW developer speak:
 *
 *     r_source = r · (1 + k1·r² + k2·r⁴)
 *
 * written in the CORRECTED-to-SOURCE direction, because a warp is drawn by
 * walking the output and asking where each pixel came from — the same direction
 * `geometry.ts` works in, for the same reason.
 *
 * The radius is normalised to HALF THE DIAGONAL, so a number means the same
 * thing on a 3:2 frame and on a 4:5 crop of it. (Lensfun's distortion models
 * put r = 1 at half the SHORT side of their calibration sensor, and its
 * vignetting at the corner — `shared/lens/lensfun.ts` converts both.)
 *
 * **No coefficient here is invented.** A lens profile is MEASURED calibration
 * data, and inventing coefficients for a camera nobody measured would be a
 * fabricated correction — worse than none, because it looks authoritative. The
 * sliders correct by eye against a straight edge, which works on any lens; a
 * MEASURED profile from Lensfun (`LensProfileTerms`, below) is applied under
 * them when the picture's lens is in that database.
 *
 * Pure and DOM-free.
 */

import { fromLinear, toLinear } from '../lut/transfer';

export interface LensCorrection {
  /**
   * −100..100. The k1 term: below 0 undoes BARREL (a wide lens bulging
   * outwards), above 0 undoes PINCUSHION.
   */
  distortion: number;
  /** −100..100. The k2 term, which is what a moustache curve needs. */
  distortion2: number;
  /**
   * −100..100 each. Lateral chromatic aberration: red and blue are scaled
   * against green, which is what takes the coloured fringes off a high-contrast
   * edge near the corners.
   */
  chromaRed: number;
  chromaBlue: number;
  /** −100..100. Above 0 lifts the corners, which is how vignetting is removed. */
  vignette: number;
  /** 0..100. How far out the lift starts to bite; higher keeps the centre clear. */
  vignetteMidpoint: number;
}

export const DEFAULT_LENS: Readonly<LensCorrection> = Object.freeze({
  distortion: 0,
  distortion2: 0,
  chromaRed: 0,
  chromaBlue: 0,
  vignette: 0,
  vignetteMidpoint: 50,
});

/**
 * ±100 moves a corner by this fraction of the half-diagonal.
 *
 * The pair is chosen so the radius map CANNOT FOLD inside the frame, which is
 * the one way this control can break a picture rather than merely overdo it.
 * The map is `f(r) = r(1 + k1·r² + k2·r⁴)`, so
 *
 *     f'(r) = 1 + 3·k1·r² + 5·k2·r⁴
 *
 * and the worst case is both sliders at −100 at the corner, where r = 1:
 * `1 − 3(0.18) − 5(0.06) = 0.16`, still positive. At the 0.25 / 0.12 this
 * started with it was −0.35, and the map turned back on itself past r ≈ 0.90 —
 * the corners would have folded over. A spec walks the frame and asserts
 * monotonicity at every extreme, which is how that was found.
 *
 * 18 % at the corner is far more than any real lens asks for (a strong wide
 * angle wants a few per cent), so nothing useful was given up.
 */
const DISTORTION_REACH = 0.18;
const DISTORTION2_REACH = 0.06;
/** ±100 scales a channel by this much against green. */
const CHROMA_REACH = 0.01;
/** ±100 changes a corner's brightness by this much. */
const VIGNETTE_REACH = 0.8;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isDefaultLens(l: LensCorrection | null | undefined): boolean {
  if (!l) return true;
  return (
    l.distortion === 0 &&
    l.distortion2 === 0 &&
    l.chromaRed === 0 &&
    l.chromaBlue === 0 &&
    l.vignette === 0
  );
}

export function normaliseLens(raw: unknown): LensCorrection {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    distortion: clamp(num(src.distortion, 0), -100, 100),
    distortion2: clamp(num(src.distortion2, 0), -100, 100),
    chromaRed: clamp(num(src.chromaRed, 0), -100, 100),
    chromaBlue: clamp(num(src.chromaBlue, 0), -100, 100),
    vignette: clamp(num(src.vignette, 0), -100, 100),
    vignetteMidpoint: clamp(num(src.vignetteMidpoint, 50), 0, 100),
  };
}

export function lensOrNull(raw: unknown): LensCorrection | null {
  if (raw === null || raw === undefined) return null;
  const l = normaliseLens(raw);
  return isDefaultLens(l) ? null : l;
}

export function sameLens(a: LensCorrection | null | undefined, b: LensCorrection | null | undefined): boolean {
  const x = { ...DEFAULT_LENS, ...(a ?? {}) };
  const y = { ...DEFAULT_LENS, ...(b ?? {}) };
  return (
    x.distortion === y.distortion &&
    x.distortion2 === y.distortion2 &&
    x.chromaRed === y.chromaRed &&
    x.chromaBlue === y.chromaBlue &&
    x.vignette === y.vignette &&
    x.vignetteMidpoint === y.vignetteMidpoint
  );
}

/** The two polynomial coefficients as the shader wants them. */
export function distortionTerms(l: LensCorrection): { k1: number; k2: number } {
  return {
    k1: (l.distortion / 100) * DISTORTION_REACH,
    k2: (l.distortion2 / 100) * DISTORTION2_REACH,
  };
}

/**
 * Where a corrected point at radius `r` came from, in the same units.
 *
 * `r` is normalised to half the diagonal, so the frame's own corner is at 1.
 * The centre is a fixed point by construction — `r = 0` gives 0 whatever the
 * coefficients — which is what makes the correction pivot on the middle of the
 * picture rather than sliding it.
 */
export function lensSampleRadius(r: number, k1: number, k2: number): number {
  const r2 = r * r;
  return r * (1 + k1 * r2 + k2 * r2 * r2);
}

/**
 * The per-channel scale for lateral chromatic aberration. Green is the
 * reference and never moves: fringes are red and blue landing at slightly the
 * wrong size, so those are what is resized.
 */
export function chromaScales(l: LensCorrection): { red: number; blue: number } {
  return {
    red: 1 + (l.chromaRed / 100) * CHROMA_REACH,
    blue: 1 + (l.chromaBlue / 100) * CHROMA_REACH,
  };
}

/**
 * The LIGHT a pixel at radius `r` is multiplied by — a gain on the decoded
 * value, never on the code (`vignetteEncoded`).
 *
 * 1 at the centre always — a correction that lifted the middle would be an
 * exposure slider wearing the wrong name. The midpoint decides how much of the
 * frame stays untouched before the lift begins.
 */
export function vignetteGain(r: number, amount: number, midpoint: number): number {
  if (!amount) return 1;
  const { amount: scaled, start } = vignetteTerms({ ...DEFAULT_LENS, vignette: amount, vignetteMidpoint: midpoint });
  if (r <= start) return 1;
  const span = 1 - start;
  // Squared, so the lift comes on gently rather than with a visible ring at
  // the point it starts.
  const t = span > 0 ? ((r - start) / span) ** 2 : 0;
  return 1 + scaled * t;
}

/**
 * What an sRGB-ENCODED value becomes once the gain at radius `r` is applied
 * to its LIGHT — which is the only place a vignette correction is right.
 *
 * A lens loses light at the corner, not code; multiplying the encoded value
 * instead would be a tone-dependent correction (×1.8 on a dark corner is ×3 on
 * its light, on a bright one barely ×2), a corner that comes back the wrong
 * colour on anything but mid grey. Every RAW developer applies it in linear.
 * This is the function the shader mirrors and `check-render.mjs` holds it to;
 * `vignetteGain` stays the gain, in light. Clamped at white: an 8-bit readback
 * is what the gate compares, and the GPU keeps the headroom on its own.
 */
export function vignetteEncoded(encoded: number, r: number, amount: number, midpoint: number): number {
  const gain = vignetteGain(r, amount, midpoint);
  if (gain === 1) return encoded;
  return fromLinear(toLinear(encoded, 'srgb') * gain, 'srgb');
}

/**
 * The same two numbers the shader wants, so `VIGNETTE_REACH` is stated ONCE and
 * the GPU cannot drift from `vignetteGain`. `check-render.mjs` compares the two.
 */
export function vignetteTerms(l: LensCorrection): { amount: number; start: number } {
  return {
    amount: (clamp(l.vignette, -100, 100) / 100) * VIGNETTE_REACH,
    start: clamp(l.vignetteMidpoint, 0, 100) / 100,
  };
}

// --- a MEASURED profile (Lensfun, `shared/lens/lensfun.ts`) ---------------------

/**
 * A lens profile in THIS module's units — r = 1 at the corner of the picture —
 * composed after the manual sliders, which then correct what the profile
 * leaves (`lensfun.ts` converts a Lensfun calibration into these):
 *
 *     m   = lensSampleRadius(r)                          the manual map
 *     r_s = m · (1 + d1·m + d2·m² + d3·m³ + d4·m⁴)       distortion
 *     r_c = r_s · (v + c·r_s + b·r_s²)                   red and blue, TCA
 *     light = observed / (1 + k1·r_s² + k2·r_s⁴ + k3·r_s⁶)   vignetting, at r_s
 *
 * A distortion polynomial with ODD terms, unlike the sliders': Lensfun's
 * `ptlens` model has them, and dropping them would be a different lens.
 * Vignetting is read at the SOURCE radius because Lensfun corrects it on the
 * picture as it came off the sensor, before any geometry.
 */
export interface LensProfileTerms {
  distortion: [number, number, number, number];
  tcaRed: [number, number, number];
  tcaBlue: [number, number, number];
  vignette: [number, number, number];
}

export const NO_PROFILE_TERMS: Readonly<LensProfileTerms> = Object.freeze({
  distortion: [0, 0, 0, 0] as [number, number, number, number],
  tcaRed: [1, 0, 0] as [number, number, number],
  tcaBlue: [1, 0, 0] as [number, number, number],
  vignette: [0, 0, 0] as [number, number, number],
});

export function isIdentityProfile(p: LensProfileTerms | null | undefined): boolean {
  if (!p) return true;
  return (
    p.distortion.every((v) => v === 0) &&
    p.tcaRed[0] === 1 && p.tcaRed[1] === 0 && p.tcaRed[2] === 0 &&
    p.tcaBlue[0] === 1 && p.tcaBlue[1] === 0 && p.tcaBlue[2] === 0 &&
    p.vignette.every((v) => v === 0)
  );
}

export function sameProfileTerms(a: LensProfileTerms | null | undefined, b: LensProfileTerms | null | undefined): boolean {
  if (isIdentityProfile(a) || isIdentityProfile(b)) return isIdentityProfile(a) && isIdentityProfile(b);
  const eq = (x: readonly number[], y: readonly number[]) => x.every((v, i) => v === y[i]);
  return eq(a!.distortion, b!.distortion) && eq(a!.tcaRed, b!.tcaRed) && eq(a!.tcaBlue, b!.tcaBlue) && eq(a!.vignette, b!.vignette);
}

/** The profile's source radius for a manual-mapped radius `m` — Horner's form, the shader's own. */
export function profileSourceRadius(m: number, d: readonly number[]): number {
  return m * (1 + m * (d[0] + m * (d[1] + m * (d[2] + m * d[3]))));
}

/** One channel's radius against green's source radius `rs` — `[v, c, b]`. */
export function profileChannelRadius(rs: number, t: readonly number[]): number {
  return rs * (t[0] + rs * (t[1] + rs * t[2]));
}

/** The gain on LIGHT that undoes the measured vignetting at source radius `rs`. */
export function profileVignetteGain(rs: number, k: readonly number[]): number {
  const r2 = rs * rs;
  return 1 / (1 + r2 * (k[0] + r2 * (k[1] + r2 * k[2])));
}

/** `barrel −40 · CA red +12 · vignette +30`, or an empty string when it does nothing. */
export function describeLens(l: LensCorrection | null | undefined): string {
  if (isDefaultLens(l) || !l) return '';
  const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
  const parts: string[] = [];
  if (l.distortion) parts.push(`${l.distortion < 0 ? 'barrel' : 'pincushion'} ${signed(l.distortion)}`);
  if (l.distortion2) parts.push(`k2 ${signed(l.distortion2)}`);
  if (l.chromaRed) parts.push(`CA red ${signed(l.chromaRed)}`);
  if (l.chromaBlue) parts.push(`CA blue ${signed(l.chromaBlue)}`);
  if (l.vignette) parts.push(`vignette ${signed(l.vignette)}`);
  return parts.join(' · ');
}
