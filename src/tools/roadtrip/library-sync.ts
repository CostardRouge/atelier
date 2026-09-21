/**
 * Who follows whom when the Library's tick and the open slide disagree.
 *
 * The two are kept pointed at the same picture BOTH ways (`use-slide-library.ts`):
 * opening a slide ticks its picture in the sidebar, and ticking another picture
 * re-points the slide. What that symmetry hides is that the two sides are not
 * peers — the document is the work, the tick is a view of it — so a
 * disagreement was read as "the Library wins", and every edit that moved a
 * picture UNDER the tick was written straight back.
 *
 * Measured, all three the same fault: an **undo** put the previous picture back
 * and the tick copied the new one over it within the same breath, so the button
 * looked dead (the maintainer's report, on a collage, where stepping between
 * cells makes it constant); **Clear** left the cell holding what it had just
 * dropped; and a slide whose picture the pool had lost took whatever happened
 * to be ticked on the next unrelated edit.
 *
 * So a disagreement is settled by WHICH SIDE MOVED. The tick moved — the author
 * picked a picture — and the slide takes it. Anything else is the document
 * moving (an undo, a redo, a cleared cell, a drop on another cell, another cell
 * selected), and the Library follows it instead.
 *
 * Pure and DOM-free: the hook holds the refs that remember what moved.
 */

/** What the sync should do this pass. */
export type SyncMove =
  /** Point the Library at the picture the slide names. */
  | 'restore'
  /** Write the ticked picture onto the slide. */
  | 'record'
  /** They agree, or neither side moved. */
  | 'idle';

export interface SyncState {
  /** Has the restore already settled on the picture the slide names NOW? */
  settled: boolean;
  /** Has the Library's own tick moved since the last pass that acted on it? */
  tickMoved: boolean;
  /** The file the slide names, or null for a slide with no picture. */
  slideName: string | null;
  /** The file the Library has active, or null when nothing is ticked. */
  activeName: string | null;
}

/** Two file names for the same picture. A rename is a different picture here. */
export function sameFileName(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

export function syncMove(state: SyncState): SyncMove {
  // Until the restore has settled on THIS picture, nothing the tick says is an
  // answer about it: the sidebar is still showing the slide before.
  if (!state.settled) return 'restore';
  if (state.activeName === null) return 'idle';
  if (sameFileName(state.slideName, state.activeName)) return 'idle';
  return state.tickMoved ? 'record' : 'idle';
}

/**
 * What a restore is ABOUT: one picture of one slide, never the slide alone.
 *
 * Keyed by the slide, a picture replaced under the Library left the sidebar
 * ticked on the one the slide no longer names — and a slide with no collage
 * draws the TICKED file on the stage, so an undone picture stayed on screen
 * even once the document had let go of it. Keyed by the pair, the same change
 * re-points the Library, and a fetch is still made at most once per picture.
 */
export function restoreClaim(slideKey: string, media: { name: string } | null): string {
  return `${slideKey}\u0000${media ? media.name.toLowerCase() : ''}`;
}
