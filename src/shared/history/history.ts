/**
 * Undo and redo as a value: a past, a present, a future.
 *
 * Every editor in the suite already funnels its edits through ONE call — Trips
 * hands the whole `TripDoc` to `handleChange`, Develop the whole `RollDoc`, the
 * Studio rebuilds its document from the editing state on each autosave — so
 * history here is a stack of whole documents, not a log of operations. Nothing
 * has to describe how to invert itself, which is the half of an undo engine
 * that rots: a new field on a document is undoable the day it is added, with no
 * inverse to write and none to forget. The documents are plain JSON kept
 * immutably (a change builds a new object and shares the parts it did not
 * touch), so a snapshot costs a pointer, not a copy.
 *
 * The one thing a snapshot stack must get right is WHAT COUNTS AS ONE STEP. A
 * slider fires a change per pixel; typing a name fires one per keystroke. Undo
 * that walks back a drag one pixel at a time is not undo. So two edits MERGE
 * into one step when they arrive close together under the same label — the
 * label is what a caller says the edit was about ("the piece I am editing",
 * "the trip"), so a gesture never merges with the different thing done right
 * after it.
 *
 * Pure and DOM-free: the clock is an argument. `use-history.tsx` is the React
 * half, `undo-keys.ts` decides who owns ⌘Z.
 */

export interface HistoryState<T> {
  /** Oldest first; `present` is not in it. */
  readonly past: readonly T[];
  readonly present: T;
  /** The undone states, nearest first — what redo walks back up. */
  readonly future: readonly T[];
  /** When `present` was recorded, for merging. `SEALED` for a state nothing may merge into. */
  readonly at: number;
  /** What produced `present`. Two edits merge only if they carry the same one. */
  readonly label: string | null;
}

/** How many steps back one document keeps. */
export const HISTORY_LIMIT = 50;

/**
 * How long a gesture stays open. 700 ms is longer than the gap between two
 * frames of a drag and two keystrokes of a word, and shorter than the pause
 * before a person does the next, different thing — and it sits just under the
 * 800 ms local-save debounce, so one saved document is one undo step.
 */
export const COALESCE_MS = 700;

/**
 * A present no later edit may merge into: the state a document opened on, and
 * whatever undo or redo leaves behind. Without it the first edit after an undo
 * would swallow the state it just came back to, and the step would be gone.
 */
const SEALED = Number.NEGATIVE_INFINITY;

export function newHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [], at: SEALED, label: null };
}

export function canUndo<T>(history: HistoryState<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: HistoryState<T>): boolean {
  return history.future.length > 0;
}

export interface RecordOptions {
  /** `Date.now()` at the call site. */
  now: number;
  /** What the edit was about; two edits merge only under the same one. */
  label?: string | null;
  limit?: number;
  coalesceMs?: number;
}

/**
 * Take `next` as the new present.
 *
 * It either MERGES into the current step (same label, inside the window) or
 * pushes the present onto the past and starts one. Either way the future is
 * dropped: editing after an undo is the branch the author chose, and keeping a
 * redo across it would put back a state that never followed this one.
 */
export function record<T>(history: HistoryState<T>, next: T, options: RecordOptions): HistoryState<T> {
  if (Object.is(next, history.present)) return history;
  const label = options.label ?? null;
  const limit = options.limit ?? HISTORY_LIMIT;
  const coalesceMs = options.coalesceMs ?? COALESCE_MS;

  // `at` is -Infinity on a sealed present, so the subtraction is Infinity and
  // the test fails without a second branch for it.
  if (label === history.label && options.now - history.at <= coalesceMs) {
    return { ...history, present: next, future: [], at: options.now };
  }

  const grown = [...history.past, history.present];
  return {
    past: grown.length > limit ? grown.slice(grown.length - limit) : grown,
    present: next,
    future: [],
    at: options.now,
    label,
  };
}

/** Step back. Unchanged when there is nothing to step back to. */
export function undo<T>(history: HistoryState<T>): HistoryState<T> {
  if (!canUndo(history)) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
    at: SEALED,
    label: null,
  };
}

/** Step forward again, while nothing has been edited since the undo. */
export function redo<T>(history: HistoryState<T>): HistoryState<T> {
  if (!canRedo(history)) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
    at: SEALED,
    label: null,
  };
}

/**
 * Close the current step, so the next edit starts a new one whatever the clock
 * says. What a caller reaches for when a gesture ends at a moment only it knows
 * about — a media switched under the editor, a sheet closed.
 */
export function seal<T>(history: HistoryState<T>): HistoryState<T> {
  return history.at === SEALED ? history : { ...history, at: SEALED };
}

/**
 * Same own keys, same values by `Object.is`.
 *
 * The comparison an editor needs when its "document" is a slice ASSEMBLED from
 * a dozen `useState` values (the Studio): the slice object is rebuilt on every
 * render, so identity says "edited" when nothing was. One level deep is exactly
 * right — each member of such a slice is itself held immutably, so an unchanged
 * member is the same object.
 */
export function shallowSame<T extends object>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (k) => Object.prototype.hasOwnProperty.call(right, k) && Object.is(left[k], right[k]),
  );
}
