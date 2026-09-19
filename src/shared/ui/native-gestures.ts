/**
 * Refusing the BROWSER's own pinch on a surface that has its own.
 *
 * **The trap, and it is invisible on a desktop.** `touch-action: none` stops
 * the browser scrolling, panning and double-tap-zooming an element — every
 * gesture the *page* owns. It does not stop WebKit zooming the VISUAL
 * viewport, which is a gesture the browser chrome owns and which
 * `touch-action` was never able to reach. So on iOS a two-finger pinch over a
 * picture magnifies the whole app: the layout stands still (`app-height.ts`
 * freezes its measurement under a pinch, which is how we know this happens),
 * the pointer events that were feeding our own pinch are CANCELLED mid-gesture,
 * and the photograph never zooms. Read from the outside, the pinch "does not
 * work" — and there is nothing in the pointer code to find, because the
 * pointers simply stop arriving.
 *
 * WebKit's own `gesturestart` / `gesturechange` / `gestureend` are the only
 * handle on it, and preventing them is what leaves the pointer stream alone
 * for the surface's own arithmetic to use. They are non-standard and exist
 * nowhere else, so this is a no-op in every other engine — which is correct:
 * `touch-action: none` already suffices there.
 *
 * **Bound to the element, never to the document.** The suite's reading pages
 * must keep the browser's pinch — it is how someone enlarges text — so only a
 * surface that answers a pinch itself takes it away, and only over itself.
 *
 * The listeners must be non-passive or `preventDefault` is ignored, and the
 * `wheel` listeners that live beside them (a trackpad pinch arrives as a
 * ⌘-wheel) are already registered that way.
 */

const GESTURES = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/**
 * Take the browser's own zoom away from `el`, for as long as the returned
 * function has not been called. A null element is a no-op, so a caller can
 * pass a ref's current value without branching.
 */
export function blockNativeZoom(el: HTMLElement | null | undefined): () => void {
  if (!el) return () => {};
  const refuse = (e: Event) => e.preventDefault();
  for (const name of GESTURES) el.addEventListener(name, refuse, { passive: false });
  return () => {
    for (const name of GESTURES) el.removeEventListener(name, refuse);
  };
}
