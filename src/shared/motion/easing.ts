/**
 * ONE registry of the curves motion travels on — the overlay engine's element
 * animations (`overlay/animation.ts`) and the openers' moving heads
 * (`roadtrip/hooks/easing.ts`) both read it. Until 2026-09-16 each kept its
 * own four or five curves under different names, so a look could not say
 * the same thing in both places. Pure and DOM-free.
 *
 * Two rules the consumers depend on:
 *
 * - every curve is monotonic on 0..1, starts at 0 and ends at 1 — a stagger
 *   and a settle instant are computed from that;
 * - a curve that has a CLOSED-FORM inverse says so. A moving opener places
 *   its stops on the inverse and glides on the curve, so a stop is reached
 *   exactly at its time; it may only offer curves from `INVERTIBLE`. A curve
 *   that overshoots (back, spring) has no inverse and is for entrances only.
 */

export type EasingId =
  | 'linear'
  | 'in'
  | 'out'
  | 'in-out'
  | 'in-cubic'
  | 'out-cubic'
  | 'in-out-cubic'
  | 'out-expo';

export interface Curve {
  id: EasingId;
  label: string;
  /** Eased progress for `t` in 0..1. May exceed 1 on an overshooting curve. */
  at: (t: number) => number;
  /** The closed-form inverse, when the curve has one: `inverse(at(u)) === u`. */
  inverse?: (p: number) => number;
}

/** `ease-out-hard` is normalised so the curve really reaches 1 at t = 1. */
const EXPO_TAIL = 1 - 2 ** -10;

export const CURVES: Record<EasingId, Curve> = {
  linear: { id: 'linear', label: 'Linear', at: (t) => t, inverse: (p) => p },
  in: { id: 'in', label: 'In', at: (t) => t * t, inverse: (p) => Math.sqrt(p) },
  out: { id: 'out', label: 'Out', at: (t) => 1 - (1 - t) * (1 - t), inverse: (p) => 1 - Math.sqrt(1 - p) },
  'in-out': {
    id: 'in-out',
    label: 'In-out',
    at: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
    inverse: (p) => (p < 0.5 ? Math.sqrt(p / 2) : 1 - Math.sqrt((1 - p) / 2)),
  },
  'in-cubic': { id: 'in-cubic', label: 'In cubic', at: (t) => t ** 3, inverse: (p) => Math.cbrt(p) },
  'out-cubic': {
    id: 'out-cubic',
    label: 'Out cubic',
    at: (t) => 1 - (1 - t) ** 3,
    inverse: (p) => 1 - Math.cbrt(1 - p),
  },
  'in-out-cubic': {
    id: 'in-out-cubic',
    label: 'In-out cubic',
    at: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
    // Upper half: p = 1 − (2 − 2t)³ / 2  ⇒  2 − 2t = ∛(2(1 − p)).
    inverse: (p) => (p < 0.5 ? Math.cbrt(p / 4) : 1 - Math.cbrt(2 * (1 - p)) / 2),
  },
  'out-expo': {
    id: 'out-expo',
    label: 'Out expo',
    at: (t) => (t >= 1 ? 1 : (1 - 2 ** (-10 * t)) / EXPO_TAIL),
    inverse: (p) => -Math.log2(1 - p * EXPO_TAIL) / 10,
  },
};

export const EASING_IDS = Object.keys(CURVES) as EasingId[];

/** The curves a stop can be placed on exactly. */
export const INVERTIBLE = EASING_IDS.filter((id) => CURVES[id].inverse);

export function isEasingId(id: unknown): id is EasingId {
  return typeof id === 'string' && id in CURVES;
}

/** The curve for an id; an id this build does not know eases linearly rather than throwing. */
export function curveOf(id: string): Curve {
  return isEasingId(id) ? CURVES[id] : CURVES.linear;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Eased progress, `p` clamped to 0..1 first. */
export function easeAt(id: string, p: number): number {
  return curveOf(id).at(clamp01(p));
}
