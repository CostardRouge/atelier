import { useLayoutEffect, type RefObject } from 'react';
import { anchorOf, anchorTop, type ScrollAnchor, type SectionBox } from './scroll-anchor';

/** Every column's last anchor, for this tab's life: memory only, never stored. */
const memory = new Map<string, ScrollAnchor>();

/** How long a column built anew keeps re-applying its anchor while its parts land. */
const SETTLE_MS = 1500;

/**
 * A column that comes back where the hand left it (`scroll-anchor.ts`): the
 * nearest scroller around `contentRef` — the inspector's own column on a
 * computer, the drawer's body on a phone — is remembered under `key` as it
 * scrolls, and a column mounted under the same key is scrolled back to the
 * same SECTION (`data-section`) and offset.
 *
 * A column built anew is not its final height at once (the histogram, a
 * RAW's blocks, a look's rows land a frame or a decode later), so the anchor
 * is re-applied as the content grows, for `SETTLE_MS` — and given up the
 * moment the person scrolls themselves. Until then nothing is written, or a
 * position clamped by a column still short would overwrite the memory.
 */
export function useRememberedScroll(key: string, contentRef: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const content = contentRef.current;
    const scroller = content ? scrollParent(content) : null;
    if (!content || !scroller) return;
    const saved = memory.get(key);
    let restoring = Boolean(saved);
    const restore = () => {
      if (!restoring || !saved) return;
      scroller.scrollTop = anchorTop(saved, sectionsOf(scroller));
    };
    const settle = () => {
      restoring = false;
    };
    restore();
    const grown = new ResizeObserver(restore);
    grown.observe(content);
    const until = window.setTimeout(() => {
      settle();
      grown.disconnect();
    }, SETTLE_MS);
    let frame = 0;
    const onScroll = () => {
      if (restoring || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        memory.set(key, anchorOf(scroller.scrollTop, sectionsOf(scroller)));
      });
    };
    // A hand on the column ends the restoring at once.
    const hands = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    hands.forEach((t) => scroller.addEventListener(t, settle, { passive: true }));
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(until);
      grown.disconnect();
      cancelAnimationFrame(frame);
      hands.forEach((t) => scroller.removeEventListener(t, settle));
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [key, contentRef]);
}

/** The element itself when it scrolls, else its nearest ancestor that does. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let at: HTMLElement | null = el; at; at = at.parentElement) {
    const y = getComputedStyle(at).overflowY;
    if (y === 'auto' || y === 'scroll') return at;
  }
  return null;
}

/** The column's sections, at their tops in the scroller's content pixels. */
function sectionsOf(scroller: HTMLElement): SectionBox[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  return [...scroller.querySelectorAll<HTMLElement>('[data-section]')].map((el) => ({
    id: el.dataset.section ?? '',
    top: el.getBoundingClientRect().top - base,
  }));
}
