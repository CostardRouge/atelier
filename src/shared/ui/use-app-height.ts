/**
 * The shell's side of {@link appHeightFor}: one set of listeners for the whole
 * app, publishing the measured screen height as `--app-h` on `<html>`.
 *
 * Same direction as `use-layout-mode.tsx` — the shell measures once and every
 * box reads the answer, rather than each one asking the browser a question it
 * sometimes answers wrongly (`app-height.ts` carries the why).
 *
 * An inline style on the root element beats the stylesheet's fallback whatever
 * the layer order, so there is nothing to keep in sync: the CSS says `100dvh`
 * until the first measurement lands, and the measurement after that.
 */

import { useEffect } from 'react';
import { APP_HEIGHT_VAR, appHeightFor, type ViewportReading } from './app-height';

/**
 * The last published measurement. Module state rather than a context: the
 * consumers that need the NUMBER are pointer handlers turning a drag into a
 * fraction of the screen, which run outside React's render and must agree with
 * the CSS to the pixel.
 */
let published: number | null = null;

function readViewport(): ViewportReading {
  const visual = window.visualViewport;
  return {
    layout: window.innerHeight,
    visual: visual ? { height: visual.height, scale: visual.scale } : null,
  };
}

/**
 * The height the app is laid out at right now, for arithmetic that has to
 * match it — a sheet's drag, mostly. Falls back to `window.innerHeight` before
 * the first measurement, which is what the code here used to read outright.
 */
export function readAppHeight(): number {
  if (published !== null) return published;
  return typeof window === 'undefined' ? 0 : window.innerHeight;
}

/** Publishes `--app-h` for the life of the app. Called once, by the shell. */
export function useAppHeight(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    const apply = () => {
      const next = appHeightFor(readViewport());
      if (next === null || next === published) return;
      published = next;
      root.style.setProperty(APP_HEIGHT_VAR, `${next}px`);
    };
    apply();

    const visual = window.visualViewport;
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    // Two moments that hand back a different screen without being a resize: a
    // page restored from the back/forward cache, and the return from another
    // app or tab — a phone's browser can have retracted or restored its
    // toolbars in between, which is the whole of this bug.
    window.addEventListener('pageshow', apply);
    document.addEventListener('visibilitychange', apply);
    visual?.addEventListener('resize', apply);
    // The mount measurement can be taken while iOS is still settling the
    // chrome it kept across a reload; `load` is the next honest moment to ask
    // again, and it is a moment rather than a timer.
    const settled = document.readyState === 'complete';
    if (!settled) window.addEventListener('load', apply);

    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      window.removeEventListener('pageshow', apply);
      document.removeEventListener('visibilitychange', apply);
      visual?.removeEventListener('resize', apply);
      if (!settled) window.removeEventListener('load', apply);
    };
  }, []);
}
