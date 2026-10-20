/**
 * Holding the picture still shows it AS SHOT (2026-10-20, his ask): the
 * long press every phone's photo editor means "before" by, on every device —
 * the `◐` pill and `\` stay a computer's way in, the press is the gesture.
 *
 * What keeps it apart from the deck's swipe is the hand's TRAVEL, never the
 * device: a press that leaves its slop before the delay is a swipe (or a pan,
 * or the divider) and never becomes a hold; a press held still past it is
 * the hold, and from then on the gesture is locked — the finger may wander,
 * the deck does not page and the press is no tap, until it lifts. Same delay
 * and slop as every long press of the suite (`press-intent.ts`).
 *
 * Pure, so the thresholds are tested rather than felt.
 */

import { LONG_PRESS_MS, PRESS_SLOP } from '../ui/press-intent';

/** How long a still press is held before the picture turns to its before. */
export const HOLD_BEFORE_MS = LONG_PRESS_MS;
/** How far the press may wander and still become a hold, in CSS pixels. */
export const HOLD_BEFORE_SLOP = PRESS_SLOP;

/**
 * Whether a press may become a hold: the first finger or the main button,
 * and nothing else owning the pointer — a mask tool or the dropper takes the
 * press whole, and with the split on a MOUSE places the divider at once (a
 * finger only places it on its lift, so it can still be held).
 */
export function holdArms({
  pointerType,
  button,
  fingers,
  suspended,
  compare,
}: {
  pointerType: string;
  button: number;
  fingers: number;
  suspended: boolean;
  compare: boolean;
}): boolean {
  if (suspended) return false;
  if (pointerType === 'touch') return fingers === 1;
  return button === 0 && !compare;
}

/** A press that travelled past the slop before the delay is no hold. */
export function holdBroken(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > HOLD_BEFORE_SLOP;
}
