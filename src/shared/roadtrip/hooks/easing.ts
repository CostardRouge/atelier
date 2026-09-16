/**
 * The easings the hook variants share — the openers' NAMES for curves that
 * live in `shared/motion/easing.ts`, the one registry the overlay engine reads
 * too. The ids here are the ones stored in every Défilé, Itinerary and Virée
 * option, so they stay as aliases; the labels and hints are the openers' own
 * words (a head "settles" on today, a pen "brakes").
 *
 * A variant that moves places its stops on the INVERSE of the chosen curve and
 * glides on the curve itself, so a stop is reached EXACTLY at its time rather
 * than near it — which is why every curve offered here has a closed-form
 * inverse and why nothing is bisected. Pure and DOM-free.
 */

import { CURVES, type EasingId } from '../../motion/easing';

export type HookEasing = 'ease-out' | 'ease-out-hard' | 'linear' | 'ease-in' | 'ease-in-out';

/** Which registry curve each opener id stands for. */
export const HOOK_EASING_CURVE: Record<HookEasing, EasingId> = {
  'ease-out': 'out-cubic',
  'ease-out-hard': 'out-expo',
  linear: 'linear',
  'ease-in': 'in-cubic',
  'ease-in-out': 'in-out-cubic',
};

const WORDS: Record<HookEasing, { label: string; hint: string }> = {
  'ease-out': { label: 'Settle', hint: 'Fast off the start, coming to rest on today' },
  'ease-out-hard': {
    label: 'Brake',
    hint: 'A hard stop — most of the trip goes by in the first half-second',
  },
  linear: { label: 'Even', hint: 'Every day takes the same time — a metronome, not a mechanism' },
  'ease-in': { label: 'Wind up', hint: 'Slow to leave, arriving at speed' },
  'ease-in-out': { label: 'Glide', hint: 'Slow to leave and slow to arrive' },
};

/**
 * The curves a moving opener may travel on — the scrub's head, the route's pen —
 * each with the inverse a stop placement needs. `u` and `p` are both 0..1; every
 * curve is monotonic, starts at 0 and ends at 1, so `inverse(ease(u)) === u` to
 * floating precision.
 */
export const EASINGS: Record<
  HookEasing,
  { label: string; hint: string; ease: (u: number) => number; inverse: (p: number) => number }
> = Object.fromEntries(
  (Object.keys(HOOK_EASING_CURVE) as HookEasing[]).map((id) => {
    const curve = CURVES[HOOK_EASING_CURVE[id]];
    if (!curve.inverse) throw new Error(`hook easing ${id} needs an invertible curve`);
    return [id, { ...WORDS[id], ease: curve.at, inverse: curve.inverse }];
  }),
) as Record<
  HookEasing,
  { label: string; hint: string; ease: (u: number) => number; inverse: (p: number) => number }
>;

export const EASING_IDS = Object.keys(EASINGS) as HookEasing[];
