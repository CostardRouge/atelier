/**
 * The easings the hook variants share.
 *
 * A variant that moves places its stops on the INVERSE of the chosen curve and
 * glides on the curve itself, so a stop is reached EXACTLY at its time rather
 * than near it — which is why every curve here has a closed-form inverse and
 * why nothing is bisected. Pure and DOM-free.
 */

export type HookEasing = 'ease-out' | 'ease-out-hard' | 'linear' | 'ease-in' | 'ease-in-out';

/**
 * The curves a moving opener may travel on — the scrub's head, the route's pen —
 * each with the inverse a stop placement needs. `u` and `p` are both 0..1; every curve is monotonic, starts at 0 and
 * ends at 1, so `inverse(ease(u)) === u` to floating precision.
 */
export const EASINGS: Record<
  HookEasing,
  { label: string; hint: string; ease: (u: number) => number; inverse: (p: number) => number }
> = {
  'ease-out': {
    label: 'Settle',
    hint: 'Fast off the start, coming to rest on today',
    ease: (u) => 1 - (1 - u) ** 3,
    inverse: (p) => 1 - Math.cbrt(1 - p),
  },
  'ease-out-hard': {
    label: 'Brake',
    hint: 'A hard stop — most of the trip goes by in the first half-second',
    // Normalised so the curve really reaches 1 at u = 1.
    ease: (u) => (1 - 2 ** (-10 * u)) / (1 - 2 ** -10),
    inverse: (p) => -Math.log2(1 - p * (1 - 2 ** -10)) / 10,
  },
  linear: {
    label: 'Even',
    hint: 'Every day takes the same time — a metronome, not a mechanism',
    ease: (u) => u,
    inverse: (p) => p,
  },
  'ease-in': {
    label: 'Wind up',
    hint: 'Slow to leave, arriving at speed',
    ease: (u) => u ** 3,
    inverse: (p) => Math.cbrt(p),
  },
  'ease-in-out': {
    label: 'Glide',
    hint: 'Slow to leave and slow to arrive',
    ease: (u) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2),
    // Upper half: p = 1 − (2 − 2u)³ / 2  ⇒  2 − 2u = ∛(2(1 − p)).
    inverse: (p) => (p < 0.5 ? Math.cbrt(p / 4) : 1 - Math.cbrt(2 * (1 - p)) / 2),
  },
};

export const EASING_IDS = Object.keys(EASINGS) as HookEasing[];
