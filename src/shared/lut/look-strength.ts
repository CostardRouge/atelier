/**
 * How strongly a LOOK lands when nobody has said — the maintainer's rule
 * (2026-10-12): *a LUT is almost never applied at 100 %*; at full strength a
 * creative look, and above all a purchased pack's, saturates and exaggerates
 * a picture until it is unusable. So a creative look is born at
 * `LOOK_STRENGTH` and the author (or the agent, measuring — `fit-strength.ts`)
 * raises it from there.
 *
 * The one exception is a CONVERSION LUT — a log-to-Rec.709 transform, the
 * `log` family (`familyForLookName`, a pack look's `family`): it maps a camera's
 * log curve to a display, and half of it leaves the picture half in log. It
 * lands whole.
 *
 * Pure.
 */

import type { PackFamily } from './lut-pack';

/** Where a creative look starts: enough to read it, far from its excess. */
export const LOOK_STRENGTH = 0.4;

/** The strength a look of this family lands at when nobody has chosen one. */
export function defaultLookStrength(family: PackFamily): number {
  return family === 'log' ? 1 : LOOK_STRENGTH;
}
