import { useCallback, useEffect, useRef } from 'react';
import { arrived, drafted, flushed, newWriteThrough, type WriteThrough } from './write-through';

/** How long the numbers rest before they are written to the document. */
export const WRITE_DELAY_MS = 200;

export interface WriteThroughOptions<T> {
  /** The value as the DOCUMENT holds it — null where that means "at rest" (as shot, uncropped). */
  stored: T | null;
  /** The draft, as the document would hold it — null under the same rule. */
  draft: T | null;
  /** Are two stored values the same thing? By what they say, never by identity. */
  same: (a: T | null, b: T | null) => boolean;
  /** Put the draft into the document. */
  onWrite: (value: T | null) => void;
  /** Take the document's own value back into the draft. */
  onReseed: (value: T | null) => void;
  delayMs?: number;
}

/**
 * The React half of `write-through.ts`: one editor draft kept level with the
 * document, in both directions.
 *
 * It owns the rest timer — a slider fires per pixel and a crop drag far more
 * often than that, so a write waits for the hand to stop — and it flushes what
 * it owes when the draft unmounts, which is how stepping to the next picture
 * keeps the last one's numbers.
 *
 * The other direction is what makes undo work in an editor with no Done: when
 * the document moves to something this draft did not write, the draft is
 * re-seeded and the pending write dropped. See `write-through.ts` for why that
 * is the whole rule.
 */
export function useWriteThrough<T>(options: WriteThroughOptions<T>): void {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef<WriteThrough<T>>(newWriteThrough(options.stored));
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const { state: next, owed, value } = flushed(state.current);
    state.current = next;
    if (owed) latest.current.onWrite(value);
  }, []);

  const { draft, stored } = options;

  // The draft moved: the document owes a write once the hand stops.
  useEffect(() => {
    const { same, delayMs = WRITE_DELAY_MS } = latest.current;
    state.current = drafted(state.current, draft, same);
    if (!state.current.pending) {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delayMs);
  }, [draft, flush]);

  // The document moved. Runs AFTER the effect above in the same commit, so a
  // value that arrived from elsewhere wins over a write scheduled this tick.
  useEffect(() => {
    const move = arrived(state.current, stored, latest.current.same);
    state.current = move.state;
    if (!move.reseed) return;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    latest.current.onReseed(stored);
  }, [stored]);

  // Leaving the draft writes what has not been written yet.
  useEffect(() => () => flush(), [flush]);
}
