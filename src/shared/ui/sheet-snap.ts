/**
 * Where a dragged bottom sheet lands when the finger lifts.
 *
 * A sheet on a phone is not a modal that is either open or shut: it rests at a
 * few declared heights, and the drag between them is the control. All of that
 * is arithmetic, so it lives here — DOM-free and tested — and the component
 * beside it only turns pointer events into a fraction and back.
 *
 * Heights are FRACTIONS of the viewport (0…1), never pixels: the sheet is
 * sized in `dvh`, so the same number describes a phone in either orientation
 * and survives the iOS toolbar collapsing.
 */

/** A sheet's resting heights, smallest first, each a fraction of the screen. */
export type SnapPoints = readonly number[];

/**
 * The default rest: a little over half the screen, and nearly all of it.
 *
 * Two points, not three. A "peek" third point was drawn in the design and
 * dropped on build: peeking at a library you cannot read is a state nobody
 * chooses on purpose, and every extra stop makes the drag less predictable.
 */
export const DEFAULT_SNAPS: SnapPoints = [0.55, 0.92];

/**
 * Below this fraction, letting go closes the sheet instead of snapping back.
 *
 * It sits under the smallest default snap on purpose: a downward flick should
 * dismiss, and a sheet that springs back from a deliberate drag reads as
 * broken. A sheet whose own smallest snap is lower than this still dismisses
 * only below its own floor — see {@link snapAfterDrag}.
 */
export const DISMISS_BELOW = 0.3;

/** Keep a fraction inside the screen, with a floor nothing can drag under. */
export function clampFraction(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(0.96, Math.max(0.08, v));
}

/** The declared height nearest a fraction. Ties go to the smaller. */
export function nearestSnap(v: number, snaps: SnapPoints = DEFAULT_SNAPS): number {
  if (snaps.length === 0) return clampFraction(v);
  let best = snaps[0];
  for (const s of snaps) {
    if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  }
  return best;
}

/**
 * What a released drag means: a fraction to rest at, or `null` for "close".
 *
 * The dismissal threshold is whichever is LOWER — the shared one, or a hair
 * under the sheet's own smallest rest. A sheet that declares a small first
 * snap must still be able to sit on it, or its lowest state would be
 * unreachable by the very gesture that is supposed to reach it.
 */
export function snapAfterDrag(
  fraction: number,
  snaps: SnapPoints = DEFAULT_SNAPS,
): number | null {
  const floor = snaps.length ? Math.min(DISMISS_BELOW, snaps[0] * 0.8) : DISMISS_BELOW;
  if (fraction < floor) return null;
  return nearestSnap(fraction, snaps);
}

/**
 * The fraction a drag has reached: where it started, minus how far the finger
 * travelled DOWN the screen. A sheet grows upward, so a positive `dy` (the
 * finger moving down) shrinks it — the sign flip that is easy to get wrong and
 * impossible to see in a type.
 */
export function dragFraction(startFraction: number, dy: number, viewportHeight: number): number {
  if (!(viewportHeight > 0)) return startFraction;
  return clampFraction(startFraction - dy / viewportHeight);
}

/**
 * The next stop when the handle is TAPPED rather than dragged, cycling upward
 * and wrapping back to the smallest. A handle that only responds to a drag is
 * a control a mouse cannot use, and the keyboard binding wants the same
 * answer.
 */
export function nextSnap(current: number, snaps: SnapPoints = DEFAULT_SNAPS): number {
  if (snaps.length === 0) return current;
  const at = nearestSnap(current, snaps);
  const i = snaps.indexOf(at);
  return snaps[(i + 1) % snaps.length];
}
