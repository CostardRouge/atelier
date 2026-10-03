/**
 * A VERB's life on its button (`docs/press-feedback.md`, face E, C2).
 *
 * A press is answered at once (`press.ts`); what comes after is the verb's:
 * the button STAYS DOWN while the work runs — a finger hid the press, the key
 * shows the work —, a hairline sweeps under it once the work has lasted long
 * enough to be worth saying, and it comes back up with a ✓ (or a – when the
 * verb could not do it). A second press while it works is ignored.
 *
 * The work is often synchronous and blocks the thread (a paste re-bakes the
 * cube and re-renders a RAW), so the hook draws the button down FIRST and
 * runs the work a frame later, then waits for the thread to go quiet — the
 * picture caught up — before it says it is done. This module is the pure
 * half: the outcome's shape and the quiet test, DOM-free and tested.
 */

export type VerbPhase = 'idle' | 'working' | 'done' | 'failed';

/** How a verb went, and the few words that say so beside it (C3). */
export interface VerbOutcome {
  ok: boolean;
  word?: string;
}

/**
 * What a verb's work may return: nothing (it worked), a boolean, the word
 * itself, or the whole outcome — so a handler that already returns one of
 * these needs no wrapper.
 */
export type VerbReturn = VerbOutcome | boolean | string | null | undefined | void;

export function outcomeOf(value: VerbReturn): VerbOutcome {
  if (value === undefined || value === null || value === true) return { ok: true };
  if (value === false) return { ok: false };
  if (typeof value === 'string') return { ok: true, word: value };
  return value;
}

/** The hairline waits this long before it shows: a quicker verb never blinks it. */
export const VERB_WAIT_MS = 80;
/** How long ✓ or – stays in the glyph. */
export const VERB_DONE_MS = 900;
/** A verb never waits longer than this for the thread to go quiet. */
export const VERB_SETTLE_MAX_MS = 10_000;
/** A frame that arrives within this of the last one is a quiet frame (two at 60 Hz). */
export const QUIET_GAP_MS = 34;
/** How many quiet frames in a row mean the work and its repaint are over. */
export const QUIET_FRAMES = 3;

/**
 * Whether the thread has gone QUIET: the last `need` gaps between animation
 * frames are each a frame or so long. A re-bake or a re-render is a long task,
 * so a long gap means the picture is still catching up; a deferred bake that
 * React runs a little later is still a long gap, which is why one quiet frame
 * is not enough.
 */
export function settled(gaps: readonly number[], quiet = QUIET_GAP_MS, need = QUIET_FRAMES): boolean {
  if (gaps.length < need) return false;
  for (let i = gaps.length - need; i < gaps.length; i++) {
    if (!(gaps[i] <= quiet)) return false;
  }
  return true;
}
