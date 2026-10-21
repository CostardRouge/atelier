/**
 * Where the band scrolls to keep the open picture in view (2026-10-21, his
 * pick «centrée quand elle sort» of three in the band lab,
 * https://claude.ai/artifact/Cq3WXuQp3tkvfgxFihV4hP): nothing moves while the
 * open cell is on screen with `margin` around it, so ← / → leave the band
 * still; once it is off, the band brings it to the MIDDLE rather than the
 * nearest edge, so a jump lands with its neighbours on both sides. The two
 * ends of the roll cannot be centred and stop at the scroller's limits.
 *
 * Pure, along one axis: the cell's `start` and `size`, the scroller's
 * `scroll`, visible `extent` and largest scroll `max`.
 */
export function revealScroll(start: number, size: number, scroll: number, extent: number, max: number, margin = 0): number | null {
  if (!(extent > 0)) return null;
  const inView = start - margin >= scroll && start + size + margin <= scroll + extent;
  if (inView) return null;
  const centred = start + size / 2 - extent / 2;
  const next = Math.round(Math.min(Math.max(0, max), Math.max(0, centred)));
  return next === Math.round(scroll) ? null : next;
}
