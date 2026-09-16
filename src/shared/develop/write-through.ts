/**
 * A draft the document may move under.
 *
 * The Develop tool has no Done: the numbers being dialled are WRITTEN THROUGH
 * to the roll after a short rest. That makes the draft a second copy of a value
 * the document also holds, and a second copy has to answer the question every
 * second copy does — what happens when the other one changes on its own?
 *
 * It changes whenever the editor is not the author of the edit: an undo or a
 * redo putting a whole document back, a batch verb writing onto the open
 * picture, an instance's copy replacing the roll. The draft has to TAKE those,
 * or the sliders keep showing numbers the roll no longer holds and the next
 * nudge writes them straight back over the step — which is exactly what made
 * undo look dead in the Develop tool while the roll underneath it stepped back
 * correctly.
 *
 * So this is a two-sided rule, and the whole of it is which side spoke last:
 *
 * - the DRAFT moved → the document owes a write, after its rest;
 * - the DOCUMENT moved to something this editor did not write → the draft is
 *   stale: drop whatever was owed and re-seed from the document.
 *
 * Telling the two apart needs one remembered value — the last thing handed to
 * the document — because during a gesture the document LAGS the draft by a
 * rest, and a lagging value must not read as somebody else's edit.
 *
 * Pure and DOM-free: the timer lives in `use-write-through.ts`, the React half.
 */

export interface WriteThrough<T> {
  /** The last value handed to the document — what its own value is expected to be. */
  readonly written: T | null;
  /** A write owed but not yet made; null when nothing is owed. */
  readonly pending: { readonly value: T | null } | null;
}

/** Nothing owed, and the document's value is the one we last "wrote". */
export function newWriteThrough<T>(stored: T | null): WriteThrough<T> {
  return { written: stored, pending: null };
}

/**
 * The draft moved to `value` (as the document would hold it).
 *
 * A draft dragged back to where the document already is owes nothing — and
 * cancels what it owed, so a gesture that ends where it started is not a step.
 */
export function drafted<T>(
  w: WriteThrough<T>,
  value: T | null,
  same: (a: T | null, b: T | null) => boolean,
): WriteThrough<T> {
  if (same(value, w.written)) return w.pending ? { ...w, pending: null } : w;
  return { ...w, pending: { value } };
}

/** The rest ended. `owed` says whether there was anything to write. */
export function flushed<T>(w: WriteThrough<T>): { state: WriteThrough<T>; owed: boolean; value: T | null } {
  if (!w.pending) return { state: w, owed: false, value: w.written };
  const { value } = w.pending;
  return { state: { written: value, pending: null }, owed: true, value };
}

/**
 * The document's own value is now `value`.
 *
 * `reseed` is true only when it is not what this editor last wrote: the
 * document was changed under the draft, so the draft takes it and anything it
 * owed is dropped — a pending write would otherwise land a moment later and put
 * the undone state back.
 */
export function arrived<T>(
  w: WriteThrough<T>,
  value: T | null,
  same: (a: T | null, b: T | null) => boolean,
): { state: WriteThrough<T>; reseed: boolean } {
  if (same(value, w.written)) return { state: w, reseed: false };
  return { state: { written: value, pending: null }, reseed: true };
}
