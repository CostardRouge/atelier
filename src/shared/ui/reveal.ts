/**
 * Bring an element into view by scrolling ITS OWN scroll box, and nothing else.
 *
 * `Element.scrollIntoView` scrolls EVERY ancestor that can be scrolled — and
 * a box with `overflow: hidden` can be, programmatically. A tool screen is a
 * stack of exactly those: the shell's frame clips, and the locked document
 * (`index.css`, `data-shell="fixed"`) is `overflow: hidden` too. So keeping a
 * cell in view — the Develop band does it on every ←/→ — also slid the whole
 * frame or the whole page up whenever the cell hung past the screen's edge,
 * and nothing ever scrolled them back: a band of paper under the bottom bar,
 * the masthead gone off the top, the reported "ghost zone that lifts the UI".
 * It looked like the `dvh` bug (`app-height.ts`) and is not one: the height
 * was right, the page had been scrolled.
 *
 * The arithmetic is pure and tested; {@link revealInScroller} is the DOM half,
 * and every tool screen uses it in place of `scrollIntoView`.
 */

export type RevealMode = 'nearest' | 'center' | 'start';

/**
 * How far to move a scroll position so `[start, end]` sits inside
 * `[viewStart, viewEnd]` — all four in the same coordinates (client pixels).
 *
 * `nearest` moves nothing when the item is already whole, else the least that
 * shows it, its start winning when it is longer than the view; `center` puts
 * its middle at the view's; `start` aligns the two starts. `margin` keeps that
 * much room between the item and the view's edges.
 */
export function revealDelta(
  start: number,
  end: number,
  viewStart: number,
  viewEnd: number,
  mode: RevealMode = 'nearest',
  margin = 0,
): number {
  // The margin is CSS's `scroll-margin`: room kept between the item and the
  // view's edge, so a cell revealed in a padded list keeps its padding.
  viewStart += margin;
  viewEnd -= margin;
  if (mode === 'center') return (start + end) / 2 - (viewStart + viewEnd) / 2;
  if (mode === 'start') return start - viewStart;
  if (start >= viewStart && end <= viewEnd) return 0;
  if (start < viewStart || end - start > viewEnd - viewStart) return start - viewStart;
  return end - viewEnd;
}

const SCROLLS = /^(auto|scroll|overlay)$/;

function scrollsOn(node: HTMLElement, axis: 'x' | 'y'): boolean {
  const style = getComputedStyle(node);
  return SCROLLS.test(axis === 'y' ? style.overflowY : style.overflowX);
}

/**
 * The box to scroll on that axis: the one named, if it scrolls on it, else the
 * nearest ancestor that scrolls on it because it says so — never a clipping one.
 * Also what a held row scrolls (`use-list-reorder.ts`).
 */
export function scrollerOf(el: HTMLElement, axis: 'x' | 'y', named?: HTMLElement | null): HTMLElement | null {
  if (named) return scrollsOn(named, axis) ? named : null;
  for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (scrollsOn(node, axis)) return node;
  }
  return null;
}

/**
 * `scrollIntoView` that moves only the boxes MEANT to scroll — the nearest
 * `overflow: auto | scroll` ancestor on each axis — and never a clipping box
 * or the document. Omit an axis to leave it alone; name `scroller` to move
 * that box and nothing else.
 */
export function revealInScroller(
  el: HTMLElement | null | undefined,
  {
    block = 'nearest',
    inline,
    behavior = 'auto',
    margin = 0,
    scroller: named,
  }: {
    block?: RevealMode | null;
    inline?: RevealMode | null;
    behavior?: ScrollBehavior;
    margin?: number;
    /** Scroll this box alone, on the axes it scrolls — a list that must never move what holds it. */
    scroller?: HTMLElement | null;
  } = {},
): void {
  if (!el) return;
  const box = el.getBoundingClientRect();
  if (block) {
    const scroller = scrollerOf(el, 'y', named);
    if (scroller) {
      const view = scroller.getBoundingClientRect();
      const top = view.top + scroller.clientTop;
      const delta = revealDelta(box.top, box.bottom, top, top + scroller.clientHeight, block, margin);
      if (Math.abs(delta) >= 1) scroller.scrollBy({ top: delta, behavior });
    }
  }
  if (inline) {
    const scroller = scrollerOf(el, 'x', named);
    if (scroller) {
      const view = scroller.getBoundingClientRect();
      const left = view.left + scroller.clientLeft;
      const delta = revealDelta(box.left, box.right, left, left + scroller.clientWidth, inline, margin);
      if (Math.abs(delta) >= 1) scroller.scrollBy({ left: delta, behavior });
    }
  }
}
