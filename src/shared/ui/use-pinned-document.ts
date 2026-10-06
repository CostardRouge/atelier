/**
 * A locked tool screen keeps its document at the TOP.
 *
 * `index.css` makes a tool screen's document `overflow: hidden`, which stops a
 * finger and nothing else: a box that clips can still be scrolled by code, and
 * two things do it. A `scrollIntoView` reaching past its own list (now
 * `revealInScroller`, `reveal.ts`), and iOS itself, which scrolls the page to
 * lift a focused field above the keyboard and does not always scroll it back
 * when the keyboard goes. Either way the whole interface sits higher than the
 * screen with a band of nothing under it, and stays there — a locked page has
 * no scroll left to put it back with.
 *
 * So the shell puts it back: any scroll of the document while the screen is
 * locked is returned to 0, unless a text field has the focus — there the
 * browser's lift is what keeps the caret above the keyboard, and the page is
 * pinned again the moment the field lets go.
 */

import { useEffect } from 'react';
import { describeKeyTarget, targetTakesText } from '../media/transport-keys';

function scrolled(): boolean {
  return window.scrollX !== 0 || window.scrollY !== 0;
}

/** While `locked`, the document is held at 0,0. Called once, by the shell. */
export function usePinnedDocument(locked: boolean): void {
  useEffect(() => {
    if (!locked || typeof window === 'undefined') return;
    const typing = () => targetTakesText(describeKeyTarget(document.activeElement));
    const pin = () => {
      if (scrolled() && !typing()) window.scrollTo(0, 0);
    };
    // The focus leaves before the next one lands (a tap from one field to
    // another): wait a frame, so the keyboard's lift is not undone between two
    // fields of the same form.
    let frame = 0;
    const settle = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(pin);
    };
    pin();
    const visual = window.visualViewport;
    window.addEventListener('scroll', pin, { passive: true });
    document.addEventListener('focusout', settle);
    visual?.addEventListener('resize', settle);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', pin);
      document.removeEventListener('focusout', settle);
      visual?.removeEventListener('resize', settle);
    };
  }, [locked]);
}
