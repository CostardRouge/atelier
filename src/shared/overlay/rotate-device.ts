/**
 * The "turn your phone" pictogram's motion — pure, DOM-free.
 *
 * A social export is a flat video: there is no gesture to detect and nothing to
 * react to, so the only way to invite a viewer to rotate their screen is to
 * *show* the gesture. The tipping is therefore the message, and it has to read
 * in a fraction of a second — hence the shape of the cycle below: a beat
 * upright (so the eye finds the phone), a firm quarter turn, a beat on its side
 * (so the destination registers), then the way back.
 *
 * Like everything else in the animation layer, it is a function of time alone:
 * the same instant produces the same angle in the preview and in the burn-in.
 */

import { easeAt } from './animation';

/** Shares of one cycle: hold, turn, hold, return. They sum to 1. */
const HOLD_START = 0.18;
const TURN = 0.3;
const HOLD_END = 0.3;

/**
 * How far through the quarter turn the phone is at `local` seconds (counted
 * from the moment the element appeared), 0 = upright, 1 = fully on its side.
 *
 * With `returns` false the phone tips once and stays there for the rest of the
 * cycle — a steadier read when the prompt is only on screen for a second.
 */
export function tipProgress(local: number, cycle: number, returns = true): number {
  const len = Math.max(0.2, cycle);
  const p = (((local % len) + len) % len) / len;
  if (p < HOLD_START) return 0;
  if (p < HOLD_START + TURN) return easeAt('in-out', (p - HOLD_START) / TURN);
  if (!returns) return 1;
  const backStart = HOLD_START + TURN + HOLD_END;
  if (p < backStart) return 1;
  return 1 - easeAt('in-out', (p - backStart) / Math.max(0.001, 1 - backStart));
}

/** The pictogram's rotation in radians; positive turns clockwise on screen. */
export function tipAngle(
  local: number,
  cycle: number,
  direction: 'cw' | 'ccw' = 'cw',
  returns = true,
): number {
  const sign = direction === 'cw' ? 1 : -1;
  return (sign * tipProgress(local, cycle, returns) * Math.PI) / 2;
}
