/**
 * Reordering a list by dragging a row's GRIP — the arithmetic, pure and
 * tested; `use-list-reorder.ts` is the DOM half.
 *
 * While a row is held the list is DRAWN in the order it would land in, so the
 * other rows make room and every number already reads the order a drop would
 * write. That is why the landing is counted from the rows as drawn: the held
 * row sits among them at its tentative place, and it moves on only when the
 * pointer crosses a NEIGHBOUR's middle — never its own, which is what keeps a
 * row from flickering between two places under a still finger.
 */

/**
 * Where a held row lands: how many OTHER rows have their middle above the
 * pointer. `mids` are the rows' vertical middles in the order they are drawn,
 * the held one at `heldAt` among them (it is skipped; -1 when it is not drawn).
 * The answer is an index in the list the drop leaves behind.
 */
export function dropIndex(mids: readonly number[], heldAt: number, y: number): number {
  let index = 0;
  mids.forEach((mid, i) => {
    if (i !== heldAt && mid < y) index += 1;
  });
  return index;
}

/** How deep the band along a scroll box's edges is where a held row scrolls it, in CSS pixels. */
export const EDGE_ZONE = 44;
/** The most a held row scrolls its box in one frame — reached at the edge and past it. */
export const EDGE_STEP = 18;

/**
 * How far a scroll box scrolls this frame while a row is held at `y`: nothing
 * in its middle, faster the deeper the pointer is in the band along the top or
 * the bottom edge, and the most past the edge — so a stop dragged from the end
 * of a long list reaches the top without letting go. A box too short for two
 * bands shares its height between them.
 */
export function edgeScrollStep(
  y: number,
  top: number,
  bottom: number,
  zone = EDGE_ZONE,
  max = EDGE_STEP,
): number {
  const band = Math.min(zone, Math.max(0, (bottom - top) / 2));
  if (!(band > 0) || !Number.isFinite(y)) return 0;
  if (y < top + band) return -max * Math.min(1, (top + band - y) / band);
  if (y > bottom - band) return max * Math.min(1, (y - (bottom - band)) / band);
  return 0;
}
