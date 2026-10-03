/**
 * The WORD a verb says, beside the glyph that ran it (`docs/press-feedback.md`,
 * C3).
 *
 * Before it, Develop answered a copy in a 10.5 px clause under the picture —
 * the far side of the stage from the glyph — that never cleared, so copying
 * twice changed nothing on screen. The word now appears where the eye already
 * is, for a moment, and goes: to the LEFT of the verbs by default, the side
 * the hand does not cover (it comes from below and the right), or ABOVE them
 * where the left is someone else's room, growing from whichever end has the
 * screen's room. The status line keeps the full sentence as the log; this is
 * the glance.
 *
 * It overlays, never pushes: absolutely placed in its `relative` anchor and
 * blind to the pointer, so nothing in the row moves when it speaks.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VerbOutcome } from './verb';

/** How long a word stays beside its verbs. */
export const VERB_WORD_MS = 1600;

/** The last outcome worth a word, and the function a verb hands its outcome to. */
export function useVerbWord(ms: number = VERB_WORD_MS): [VerbOutcome | null, (outcome: VerbOutcome) => void] {
  const [word, setWord] = useState<VerbOutcome | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const say = useCallback(
    (outcome: VerbOutcome) => {
      if (!outcome.word) return;
      window.clearTimeout(timer.current);
      setWord(outcome);
      timer.current = window.setTimeout(() => setWord(null), ms);
    },
    [ms],
  );
  return [word, say];
}

// Above, the word grows from the anchor's START or its END — whichever side
// has the screen's room (a row near the left edge grows right, and back).
const SIDE = {
  left: 'right-[calc(100%+0.5rem)] top-1/2 -translate-y-1/2',
  aboveStart: 'left-0 bottom-[calc(100%+0.375rem)]',
  aboveEnd: 'right-0 bottom-[calc(100%+0.375rem)]',
} as const;

export default function VerbWord({
  word,
  side = 'left',
}: {
  word: VerbOutcome | null;
  side?: keyof typeof SIDE;
}) {
  // Kept mounted: a live region that is added with its text is often not read.
  return (
    <span
      role="status"
      aria-live="polite"
      className={`pointer-events-none absolute z-10 ${SIDE[side]} inline-flex items-center gap-1 h-6 px-2.5 max-w-[min(60vw,22rem)] rounded-full border bg-surface font-mono text-2xs whitespace-nowrap shadow-paper-soft transition-opacity duration-150 ${
        word ? 'opacity-100' : 'opacity-0'
      } ${word && !word.ok ? 'border-danger-line text-danger' : 'border-line-strong text-ink-soft'}`}
    >
      {word && <span aria-hidden="true" className={word.ok ? 'text-ok' : 'text-danger'}>{word.ok ? '✓' : '–'}</span>}
      <span className="truncate">{word?.word ?? ''}</span>
    </span>
  );
}
