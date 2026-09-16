/**
 * ONE registry of the curves motion travels on — the overlay engine's element
 * animations (`overlay/animation.ts`) and the openers' moving heads
 * (`roadtrip/hooks/easing.ts`) both read it. Until 2026-09-16 each kept its
 * own four or five curves under different names, so a look could not say
 * the same thing in both places. Pure and DOM-free.
 *
 * Three rules the consumers depend on:
 *
 * - every curve starts at 0 and ends at 1;
 * - a curve that has a CLOSED-FORM inverse says so, and is then monotonic. A
 *   moving opener places its stops on the inverse and glides on the curve, so
 *   a stop is reached exactly at its time; it may only offer `INVERTIBLE`;
 * - a curve that OVERSHOOTS (back, spring) goes past 1 on the way to rest: a
 *   scale or an offset follows it, an opacity clamps. It has no inverse and
 *   is for entrances and exits, never for a head that must land on a day.
 *
 * `steps` moves in jumps — stop-motion, the one curve that takes a number.
 */

export type EasingId =
  | 'linear'
  | 'in'
  | 'out'
  | 'in-out'
  | 'in-cubic'
  | 'out-cubic'
  | 'in-out-cubic'
  | 'out-expo'
  | 'back'
  | 'spring'
  | 'steps';

export interface Curve {
  id: EasingId;
  label: string;
  /** Eased progress for `t` in 0..1. May exceed 1 on an overshooting curve. */
  at: (t: number, steps?: number) => number;
  /** The closed-form inverse, when the curve has one: `inverse(at(u)) === u`. */
  inverse?: (p: number) => number;
  /** Goes past 1 before it rests. */
  overshoots?: boolean;
  /** Takes a step count. */
  stepped?: boolean;
}

/** `out-expo` is normalised so the curve really reaches 1 at t = 1. */
const EXPO_TAIL = 1 - 2 ** -10;

export const DEFAULT_STEPS = 4;
export const MIN_STEPS = 2;
export const MAX_STEPS = 12;

/** A step count read out of anything. */
export function clampSteps(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_STEPS;
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.round(n)));
}

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
  back: {
    id: 'back',
    label: 'Back',
    // The classic ease-out-back: overshoots by ~10% then settles.
    at: (t) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    },
    overshoots: true,
  },
  spring: {
    id: 'spring',
    label: 'Spring',
    // A damped oscillation that has died out by t = 1.
    at: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(13 * t)),
    overshoots: true,
  },
  steps: {
    id: 'steps',
    label: 'Steps',
    at: (t, steps) => {
      const n = clampSteps(steps);
      return t >= 1 ? 1 : Math.floor(t * n) / n;
    },
    stepped: true,
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

/** Eased progress, `p` clamped to 0..1 first. `steps` only matters to the stepped curve. */
export function easeAt(id: string, p: number, steps?: number): number {
  return curveOf(id).at(clamp01(p), steps);
}
