/**
 * How tall the app's screen really is — measured, not assumed.
 *
 * A tool screen locks the document (`index.css`, `data-shell="fixed"`) and
 * sizes it in `100dvh`, which is by definition the CURRENT viewport and is
 * therefore exactly the right unit — right up until the engine stops
 * recomputing it. Reported from Chrome on iOS, after a reload: the browser
 * keeps its toolbars retracted across the refresh, the page is laid out
 * against the shorter viewport they were expanded for, and the app ends ~59px
 * above the screen — a band of paper under the bottom bar. Nothing makes it go
 * away, because a locked document can never be scrolled and a scroll is what
 * would make the browser ask the question again.
 *
 * So the height is READ from the two viewports a browser exposes, and
 * published as `--app-h` for every box that means "the whole screen" to use in
 * place of `100dvh` — which stays as the variable's own fallback, for the
 * frame's first paint and for anything rendered outside the shell.
 *
 * DOM-free on purpose: reconciling the two readings is the whole of the
 * decision and it is testable in node. The listeners live in
 * `use-app-height.ts`, the React half.
 */

/** The custom property the shell publishes the measurement on. */
export const APP_HEIGHT_VAR = '--app-h';

/**
 * What a full-height box writes instead of `100dvh`. The fallback matters:
 * it is what the first paint uses, and what a component mounted in a test or
 * a throwaway harness gets.
 */
export const APP_HEIGHT = `var(${APP_HEIGHT_VAR}, 100dvh)`;

/** Both of the browser's viewports, read at the same instant. */
export interface ViewportReading {
  /**
   * `window.innerHeight` — the LAYOUT viewport: the page's own idea of how
   * tall it is. It ignores the software keyboard, which is what makes it the
   * floor of the two.
   */
  layout: number;
  /**
   * `window.visualViewport` — the region actually on screen, and the only
   * reading that grows when the browser retracts its chrome without telling
   * the layout. Null where the browser has no such object.
   */
  visual: { height: number; scale: number } | null;
}

/**
 * The height to lay the app out at, or `null` for "keep the last one".
 *
 * **The larger of the two readings.** They agree in every ordinary moment; the
 * two that matter are the ones where they don't:
 *
 * - the layout viewport is stale-short (the iOS bug above) — the visual
 *   viewport is the one that knows how much screen there is;
 * - the keyboard is up — the visual viewport has shrunk to the strip above it,
 *   and resizing the whole app to that would reflow the editor under the
 *   fingers typing in it. The layout viewport, which the keyboard does not
 *   move, wins.
 *
 * **Nothing reflows under a zoom.** While the page is pinched the visual
 * viewport describes the magnified region rather than the screen, and on some
 * engines `innerHeight` follows it — so the measurement stands still until the
 * fingers leave, rather than shrinking the layout around the gesture.
 */
export function appHeightFor(reading: ViewportReading): number | null {
  const { layout, visual } = reading;
  if (visual && Math.abs(visual.scale - 1) > 0.01) return null;
  const heights = [layout, visual?.height ?? 0].filter((n) => Number.isFinite(n) && n > 0);
  if (heights.length === 0) return null;
  return Math.round(Math.max(...heights));
}
