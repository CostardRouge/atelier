/**
 * One sound in a score — times and a voice name, never an AudioContext.
 *
 * Kept apart from anything that plays it, so a score can be written, merged,
 * sorted and tested in node, and so the thing that produces one (a hook
 * variant) never depends on the thing that renders it.
 */
export interface SoundEvent {
  /** Seconds into the composition's own life. */
  at: number;
  /** A voice from `voices.ts`; an unknown name plays as `click`. */
  voice: string;
  /** Peak level, 0..1. */
  gain?: number;
  /** Pitch multiplier, 1 = the voice as designed. */
  rate?: number;
}
