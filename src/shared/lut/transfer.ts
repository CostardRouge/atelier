/**
 * Transfer functions — the curve between a stored code value and actual light.
 *
 * A file stores CODES, not light: the display turns code into light with an
 * EOTF, `light = code^gamma`. Rec.709's reference display is BT.1886, a pure
 * gamma 2.4 tuned for a DARK grading suite; an ordinary monitor, phone or
 * browser behaves like sRGB — effectively ~2.2 — in a lit room. Feed
 * 2.4-encoded values to a 2.2 display and every midtone comes out brighter
 * than authored: +59% at code 0.1, +15% at 0.5, 0% at both ends. That uneven,
 * shadow-weighted error is why the symptom reads as "milky, lifted blacks"
 * rather than "brighter image" — the classic "my LUT looks flat" complaint.
 *
 * Every conversion LUT this app ships (D-Log→709, Apple Log→709, S-Log→709)
 * emits values authored for that Rec.709 reference display, and we draw them
 * onto a plain sRGB canvas. This module is what lets the user close that gap.
 *
 * Rec.709 and sRGB share the SAME primaries and white point, so converting
 * between them is a pure per-channel 1-D curve change: no 3x3 matrix, nothing
 * to do with gamut. That is the entire reason this is thirty lines of maths
 * rather than a colour-management subsystem.
 *
 * Pure and DOM-free.
 */

/** A named curve between code values and linear light. */
export type TransferFn = 'gamma-2.2' | 'gamma-2.4' | 'srgb';

/** A conversion the user can pick, as a (from, to) pair of curves. */
export type OutputTransform =
  | 'none'
  | 'rec709-to-srgb'
  | 'rec709-24-to-22'
  | 'srgb-to-rec709';

interface TransformOption {
  id: OutputTransform;
  /** Short label, also used to name the transform in a composed LUT's title. */
  label: string;
  /** One line of "why would I pick this", in the user's terms. */
  hint: string;
}

/**
 * The picker's contents, in display order. `none` is first and is the default
 * everywhere: an existing project must never re-grade itself on reopen.
 */
export const OUTPUT_TRANSFORM_OPTIONS: readonly TransformOption[] = [
  {
    id: 'none',
    label: 'None',
    hint: 'The look exactly as the LUT authored it.',
  },
  {
    id: 'rec709-to-srgb',
    label: 'Rec.709 2.4 → sRGB',
    hint: 'Web, phones, laptops — restores the contrast a browser eats.',
  },
  {
    id: 'rec709-24-to-22',
    label: 'Rec.709 2.4 → 2.2',
    hint: 'Same idea, pure power curve, without the sRGB toe.',
  },
  {
    id: 'srgb-to-rec709',
    label: 'sRGB → Rec.709 2.4',
    hint: 'The inverse — for a calibrated TV or a dark room.',
  },
];

/** The (from, to) curves a named transform stands for; null for `none`. */
export function transformPair(
  t: OutputTransform,
): { from: TransferFn; to: TransferFn } | null {
  switch (t) {
    case 'rec709-to-srgb':
      return { from: 'gamma-2.4', to: 'srgb' };
    case 'rec709-24-to-22':
      return { from: 'gamma-2.4', to: 'gamma-2.2' };
    case 'srgb-to-rec709':
      return { from: 'srgb', to: 'gamma-2.4' };
    case 'none':
      return null;
  }
}

/** Short label for a transform — used in the composed LUT's title. */
export function transformLabel(t: OutputTransform): string {
  return OUTPUT_TRANSFORM_OPTIONS.find((o) => o.id === t)?.label ?? 'None';
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * sRGB's toe/power join, as the standard writes it on the encoded side.
 *
 * The spec's constants are rounded, so its two segments only meet to about
 * 4.5e-8 and its two published thresholds (0.04045 encoded, 0.0031308 linear)
 * are not exactly each other's image. Deriving the linear knee from the
 * encoded one instead of hard-coding 0.0031308 costs 5e-9 of fidelity to the
 * published number and buys an exactly invertible pair of functions — which
 * matters here, because `applyTransfer` composes them and a LUT bake would
 * otherwise accumulate the mismatch.
 */
const SRGB_KNEE_ENCODED = 0.04045;
const SRGB_SLOPE = 12.92;
const SRGB_KNEE_LINEAR = SRGB_KNEE_ENCODED / SRGB_SLOPE;

/**
 * Code value → linear light, per channel.
 *
 * sRGB is the REAL piecewise curve, not a bare 2.2 power: its linear toe below
 * 0.04045 is what keeps deep shadows from crushing, and dropping it is the
 * usual way a "simplified" sRGB implementation blocks up blacks.
 */
export function toLinear(v: number, fn: TransferFn): number {
  const x = clamp01(v);
  switch (fn) {
    case 'gamma-2.2':
      return Math.pow(x, 2.2);
    case 'gamma-2.4':
      return Math.pow(x, 2.4);
    case 'srgb':
      return x <= SRGB_KNEE_ENCODED
        ? x / SRGB_SLOPE
        : Math.pow((x + 0.055) / 1.055, 2.4);
  }
}

/** Linear light → code value, per channel. The inverse of `toLinear`. */
export function fromLinear(v: number, fn: TransferFn): number {
  const x = clamp01(v);
  switch (fn) {
    case 'gamma-2.2':
      return Math.pow(x, 1 / 2.2);
    case 'gamma-2.4':
      return Math.pow(x, 1 / 2.4);
    case 'srgb':
      return x <= SRGB_KNEE_LINEAR
        ? x * SRGB_SLOPE
        : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }
}

/**
 * Re-encode one channel from its source curve to its destination curve.
 * `none` is the identity, so a caller can apply this unconditionally.
 *
 * Both endpoints are fixed points of every transform (0 → 0, 1 → 1), which is
 * what guarantees the black and white points never drift — only the shape of
 * everything in between changes.
 */
export function applyTransfer(v: number, t: OutputTransform): number {
  const pair = transformPair(t);
  if (!pair) return v;
  return clamp01(fromLinear(toLinear(v, pair.from), pair.to));
}
