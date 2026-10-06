/**
 * Focusing without moving the page.
 *
 * A plain `focus()` — and React's `autoFocus`, which is one — scrolls every
 * ancestor to show the element, clipping boxes included; on a tool screen
 * that slides the locked frame or the page itself, and nothing scrolls it
 * back (`docs/audit-mobile-layout-2026-10-06.md`). The lint refuses both;
 * these are the two shapes the suite needs instead.
 */

/** A ref that focuses its element once, when it mounts, without scrolling anything. */
export function focusOnMount(el: HTMLElement | null): void {
  el?.focus({ preventScroll: true });
}
