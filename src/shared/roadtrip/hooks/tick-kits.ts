/**
 * The tick kits the hook variants share — which voices a landing, a leg's
 * landing and the seat are played on, and how a pitch may drift along a run.
 *
 * Grown in the scrub, lifted out when the route's pen wanted to tick at the
 * places it reaches. Pure and DOM-free; the voices themselves are
 * `shared/audio/voices.ts`.
 */

import type { VoiceName } from '../../audio/voices';

export type TickKit = 'ratchet' | 'wood' | 'typewriter' | 'click';
/** How a run of ticks' pitch moves from its first to its last. */
export type TickDrift = 'flat' | 'rising' | 'falling';

/**
 * The voices a variant's ticks may be played on. Each kit names the ordinary landing,
 * how a LEG's landing departs from it (the one sound carrying meaning, so the
 * one that is different: lower and a little louder), and the seat — which
 * stays the seat in every kit, because it is the end of the phrase rather
 * than a tick.
 */
export const TICK_KITS: Record<
  TickKit,
  {
    label: string;
    hint: string;
    tick: VoiceName;
    leg: { voice: VoiceName; rate: number; gain: number };
    seat: VoiceName;
  }
> = {
  ratchet: {
    label: 'Ratchet',
    hint: 'A mechanism — a narrow click, a deeper one where a leg starts',
    tick: 'detent',
    leg: { voice: 'leg', rate: 1, gain: 1 },
    seat: 'seat',
  },
  wood: {
    label: 'Woodblock',
    hint: 'Warmer knocks, a low one where a leg starts',
    tick: 'wood',
    leg: { voice: 'wood', rate: 0.67, gain: 1.3 },
    seat: 'seat',
  },
  typewriter: {
    label: 'Typewriter',
    hint: 'A key strike a day, a heavier one where a leg starts',
    tick: 'typewriter',
    leg: { voice: 'typewriter', rate: 0.7, gain: 1.3 },
    seat: 'seat',
  },
  click: {
    label: 'Shutter',
    hint: 'A soft camera click a day',
    tick: 'click',
    leg: { voice: 'click', rate: 0.6, gain: 1.3 },
    seat: 'seat',
  },
};

export const KIT_IDS = Object.keys(TICK_KITS) as TickKit[];

/**
 * How far the pitch travels along a drifting sweep: ×0.84 at one end to ×1.19
 * at the other, about three semitones each way — audible as a climb or a fall,
 * small enough that every tick still reads as the same instrument.
 */
export const DRIFT_SPAN = { from: 0.84, to: 1.19 } as const;

/** The pitch factor at `share` (0..1) of the way along the sweep. */
export function driftAt(drift: TickDrift, share: number): number {
  const u = Math.max(0, Math.min(1, share));
  if (drift === 'rising') return DRIFT_SPAN.from + (DRIFT_SPAN.to - DRIFT_SPAN.from) * u;
  if (drift === 'falling') return DRIFT_SPAN.to - (DRIFT_SPAN.to - DRIFT_SPAN.from) * u;
  return 1;
}
