/**
 * Which parts of a span to ask for next (`span.ts`'s `spanChunks`), and which
 * to give up: the parts the person is LOOKING at or jumped to first, then the
 * rest in order, at most `max` at a time. A part being fetched that nobody
 * wants any more is aborted when a wanted one is waiting for its slot — a
 * click on December no longer waits behind January to November, and clicking
 * on and on no longer piles requests up on the instance. (pure)
 */

export type PartState = 'idle' | 'loading' | 'done' | 'failed';

export interface QueueStep {
  /** Parts to start, in order. */
  start: number[];
  /** Parts in flight to abort, to free their slots. */
  abort: number[];
}

/**
 * `wanted` is in priority order (the jump target first, then what is on
 * screen). A failed part is asked again only when wanted — never in the
 * background, so a refused part does not loop. The background goes in order,
 * one part at a time beside what is wanted.
 */
export function nextParts(states: readonly PartState[], wanted: readonly number[], max = 2): QueueStep {
  const want = [...new Set(wanted)].filter((i) => i >= 0 && i < states.length);
  const loading = states.flatMap((s, i) => (s === 'loading' ? [i] : []));
  const waiting = want.filter((i) => states[i] === 'idle' || states[i] === 'failed');
  const abort: number[] = [];
  let free = max - loading.length;
  // Free slots held by parts nobody looks at, for the parts somebody does.
  if (waiting.length > free) {
    for (const i of loading) {
      if (free >= waiting.length) break;
      if (want.includes(i)) continue;
      abort.push(i);
      free += 1;
    }
  }
  const start = waiting.slice(0, Math.max(0, free));
  free -= start.length;
  // Nothing wanted is waiting: the rest of the span, in order, one at a time.
  const inFlight = loading.length - abort.length + start.length;
  if (free > 0 && waiting.length === 0 && inFlight === 0) {
    const next = states.findIndex((s) => s === 'idle');
    if (next >= 0) start.push(next);
  }
  return { start, abort };
}

/** The part a day belongs to, by the parts' bounds (inclusive), or -1. */
export function partOf(parts: readonly { from: string; to: string }[], day: string): number {
  return parts.findIndex((p) => day >= p.from && day <= p.to);
}
