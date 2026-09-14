/**
 * What a press on a surface that ALSO answers a plain click is turning into:
 * still undecided, a drag the surface takes over, or a gesture it lets go of.
 *
 * The loupe's frame sits over clickable day cells, so a press inside it cannot
 * claim a drag on the spot. A mouse or a pen claims it by travelling past the
 * slop — a click never travels. A finger cannot: travelling is how a page is
 * scrolled, so a finger that moves early is let go (the browser pans) and a
 * drag is claimed only by HOLDING still first, the long press every phone
 * already means "pick this up" by.
 *
 * Pure, so the thresholds are tested rather than felt.
 */

/** How far a press may wander and still be a click, in CSS pixels. */
export const PRESS_SLOP = 6;
/** How long a still press must be held to become a drag. */
export const LONG_PRESS_MS = 350;

export type PressIntent = 'pending' | 'drag' | 'release';

export function pressIntent({
  pointerType,
  dx,
  dy,
  heldMs,
}: {
  pointerType: string;
  dx: number;
  dy: number;
  heldMs: number;
}): PressIntent {
  const touch = pointerType === 'touch';
  if (Math.hypot(dx, dy) > PRESS_SLOP) return touch ? 'release' : 'drag';
  // Only a finger is picked up by holding: a slow mouse click is still a click.
  return touch && heldMs >= LONG_PRESS_MS ? 'drag' : 'pending';
}
