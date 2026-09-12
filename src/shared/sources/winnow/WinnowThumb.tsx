/**
 * One tile's thumbnail from a Winnow, which retries instead of staying black.
 *
 * **The bug it exists for, met three times now.** A grid of a busy day fires a
 * hundred-odd image requests at once down a tunnel to a home server. Some lose:
 * a dropped connection, a request shed under load, or — the one that never
 * heals on its own — a cache entry poisoned by a response that arrived without
 * its CORS headers. Winnow serves derivatives `immutable` for a year, and these
 * tiles ask with `crossOrigin="use-credentials"`, so a poisoned entry fails the
 * CORS check on every later load and a reload does not clear it: the picture is
 * a black rectangle for as long as that cache lives. Reported from a phone
 * where every tile of a day was black while the same day loaded on a desktop,
 * which is exactly the shape of a cache poisoned on one device.
 *
 * An `<img>` has no answer to any of that: it fires `error` once and gives up.
 * So the tile retries with a widening delay (the failures are load-shaped, and
 * hammering makes them worse) and then says plainly that the picture would not
 * come. **Attempt 0 uses the plain URL** so the ordinary path stays as
 * cacheable as Winnow means it to be; only a retry carries the `?retry=N`
 * discriminator, which is both a genuinely new request and the thing that
 * defeats a poisoned entry.
 *
 * **Why it is shared rather than a helper inside one grid.** It was written
 * inside `WinnowBrowser` and stayed there, so the two grids added later — the
 * Library's Winnow tab (`WinnowScopeGrid`) and the piece editor's day strip
 * (`DayFromWinnow`) — each drew a bare `<img>` and re-paid the whole bug. That
 * is the second lesson `DayFromWinnow` has re-paid from that same file (the
 * first was `aspect-square` on a grid tile, `frontend.md`). Every Winnow
 * thumbnail in the suite comes from here.
 *
 * It also owns its own attempt count, where `WinnowBrowser` used to hold a
 * `Map` of them: a failing tile re-rendered the entire grid, 132 times on the
 * day that prompted the retry, and the pending timers outlived the grid.
 */

import { useEffect, useRef, useState } from 'react';
import type { WinnowClient } from './client';

/** How many times a thumbnail is asked for again before the tile gives up. */
export const THUMB_RETRIES = 3;

export interface WinnowThumbProps {
  client: WinnowClient;
  /** The asset's id on that instance. */
  id: number;
  /** What the tile says when the picture will not come — an extension, a kind. */
  label: string;
  /**
   * The tile's own box, sizing only — `w-full h-[74px]`, or `w-full h-full`
   * where the grid pins its rows in pixels itself (`DayFromWinnow`). The
   * picture and the given-up label are drawn in the same box, so a failure
   * never changes the grid's shape. A pixel height somewhere in the chain,
   * never `aspect-*`: these grids are all `auto-fill`/`minmax`, where a ratio
   * resolves against an indefinite track (`frontend.md`).
   */
  box: string;
  alt?: string;
}

export default function WinnowThumb({ client, id, label, box, alt = '' }: WinnowThumbProps) {
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<number | null>(null);

  // A new picture starts fresh, and a retry still pending for the old one is
  // dropped — on unmount too, so a grid closed mid-retry leaves nothing armed.
  useEffect(() => {
    setAttempt(0);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [id]);

  if (attempt > THUMB_RETRIES) {
    return (
      <div className={`${box} grid place-items-center bg-frame`}>
        <span className="font-mono text-[0.55rem] uppercase tracking-wide text-[#8a8270]">
          {label}
        </span>
      </div>
    );
  }

  return (
    <img
      // `key` on the attempt: React must build a NEW element, or swapping the
      // src on the failed one can be ignored by the browser.
      key={attempt}
      src={client.thumbRetryUrl(id, attempt)}
      alt={alt}
      // Served with the session cookie, so the browser is told to send it
      // cross-origin. Cross-ORIGIN and same-SITE (`docs/winnow-bridge.md`).
      crossOrigin="use-credentials"
      loading="lazy"
      decoding="async"
      className={`block object-cover ${box}`}
      onError={() => {
        const next = attempt + 1;
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setAttempt(next), next * 400);
      }}
    />
  );
}
