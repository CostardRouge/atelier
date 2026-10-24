/**
 * The A/B divider's DETENTS: the middle and the two edges hold the line while
 * the hand is near them (D2 of the divider lab, his pick on 2026-10-24 —
 * https://claude.ai/artifact/D2zmG8rmZY7orMtxAX86Jg).
 *
 * Magnetic WHILE dragging, not a snap on release: the line shows where it
 * will stay before the hand lifts. The reach is in screen pixels, never a
 * share of the picture, so a zoomed or a phone-sized picture holds the same
 * distance under the hand. The edges are detents too: 0 is the whole picture
 * corrected, 1 the whole picture as shot.
 */
export const WIPE_DETENTS: readonly number[] = [0, 0.5, 1];

/** How near, in CSS pixels across the picture, a detent takes the line. */
export const DETENT_REACH_PX = 12;

/**
 * Where the divider goes for a hand at `fraction` across a picture drawn
 * `widthPx` wide: the detent it is within reach of (`caught`), else the hand's
 * own place. `free` (⌥ held) passes every detent.
 */
export function detentOf(
  fraction: number,
  widthPx: number,
  free = false,
): { wipe: number; caught: number | null } {
  const f = Math.min(1, Math.max(0, fraction));
  if (free || !(widthPx > 0)) return { wipe: f, caught: null };
  let caught: number | null = null;
  let gap = Infinity;
  for (const d of WIPE_DETENTS) {
    const g = Math.abs(f - d) * widthPx;
    if (g <= DETENT_REACH_PX && g < gap) {
      gap = g;
      caught = d;
    }
  }
  return caught === null ? { wipe: f, caught } : { wipe: caught, caught };
}
