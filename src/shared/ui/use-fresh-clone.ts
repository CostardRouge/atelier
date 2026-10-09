import { useEffect, useRef, useState } from 'react';
import { revealInScroller } from './reveal';

/** How long the status line and the accent on the new card stay. */
const FRESH_MS = 12000;

/**
 * The document a gallery has just cloned: held so the gallery can draw it with
 * the accent (`freshId`), bring its card into view once it is on screen, and
 * say what happened in a status line (`ClonedNotice`) that lets go by itself.
 *
 * The card is found by `data-doc-id`, which every gallery card of a document
 * kind that can be cloned carries. `docs` is the list the cards are drawn from:
 * the clone is written before the list re-reads, so the scroll waits until the
 * card exists rather than guessing when.
 */
export default function useFreshClone<D extends { id: string }>(docs: readonly D[] | null) {
  const [cloned, setCloned] = useState<D | null>(null);
  const freshId = cloned?.id ?? null;

  useEffect(() => {
    if (!cloned) return;
    const timer = window.setTimeout(() => setCloned(null), FRESH_MS);
    return () => window.clearTimeout(timer);
  }, [cloned]);

  // A clone lands next to the other documents of its source, which may be a
  // screen away on a long gallery. Once per clone: the list re-reads again.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!freshId) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current === freshId) return;
    const el = document.querySelector<HTMLElement>(`[data-doc-id="${freshId}"]`);
    if (!el) return;
    scrolledTo.current = freshId;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    revealInScroller(el, { block: 'nearest', behavior: calm ? 'auto' : 'smooth', margin: 12 });
  }, [freshId, docs]);

  return { cloned, setCloned, freshId };
}
