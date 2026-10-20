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
 * So the tile retries, and the FIRST retry is not a second helping of the same
 * question. Since 2026-09-21 the poisoned entry is diagnosed (`cache-heal.ts`:
 * the answer was stored without its CORS headers, because Winnow's own pages
 * ask for the same URL with no `Origin` and the derivative routes carry no
 * `Vary: Origin`), so the tile HEALS it — one `cache: 'reload'` request that
 * replaces what the cache holds — and then asks for the plain URL again. That
 * fixes the next page load too, where the old `?retry=N` route-around left the
 * bad entry in place and paid the failure again every time. `?retry=N` stays
 * as the later attempts, for a request that was merely shed under load: a
 * genuinely new URL is the only thing that helps there, and the delay widens
 * because hammering a shedding server makes it worse.
 *
 * **The fourth time (2026-10-20), from a phone again: tiles missing at
 * random, in the picker and the Library alike.** Two more ways an `<img>`
 * says nothing, both met on mobile WebKit and both silent — no `load`, no
 * `error`, so no retry either:
 * - a `loading="lazy"` image inside a scroller that WebKit never starts (the
 *   trap Develop's band already paid, which is why it asked for `eager`). The
 *   tile now watches its own viewport with an `IntersectionObserver` and
 *   sets `src` itself when it comes within `NEAR` of the screen — the lazy
 *   attribute is gone;
 * - a request that STALLS: a phone's connection drops the response on the
 *   floor and the browser waits for it for as long as the page lives. A
 *   watch gives each attempt `LOAD_STALL_MS` to say something, and a silent
 *   one is treated as a failure.
 * The retries are also wider (a second, three, eight) and one more: a phone
 * on a weak link lost all three of the old ones inside 2.4 s, and the tile
 * then gave up for the session, which read as random. A tile that has given
 * up is not dead either: a tap, the device coming back online, or the tile
 * coming back into view starts another round.
 *
 * **Why it is shared rather than a helper inside one grid.** It was written
 * inside `WinnowBrowser` and stayed there, so the two grids added later — the
 * Library's Winnow tab (`WinnowScopeGrid`) and the piece editor's day strip
 * (since retired for that tab) — each drew a bare `<img>` and re-paid the
 * whole bug. That was the second lesson the day strip re-paid from that same
 * file (the first was `aspect-square` on a grid tile, `frontend.md`). Every
 * Winnow thumbnail in the suite comes from here.
 *
 * It also owns its own attempt count, where `WinnowBrowser` used to hold a
 * `Map` of them: a failing tile re-rendered the entire grid, 132 times on the
 * day that prompted the retry, and the pending timers outlived the grid.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WinnowClient } from './client';

/** How many times a thumbnail is asked for again before the tile gives up (for this round). */
export const THUMB_RETRIES = 4;
/** The wait before attempt N: the first retry follows the heal at once, then a second, three, eight. */
export const RETRY_DELAYS_MS: readonly number[] = [0, 0, 1000, 3000, 8000];
/** A load that has said neither `load` nor `error` for this long is treated as lost. */
export const LOAD_STALL_MS = 12_000;
/** How many rounds a tile that gave up may start again (a tap, back online, back in view). */
const MAX_ROUNDS = 3;
/** How far ahead of the viewport a tile starts loading. */
const NEAR = '600px';

export interface WinnowThumbProps {
  client: WinnowClient;
  /** The asset's id on that instance. */
  id: number;
  /** What the tile says when the picture will not come — an extension, a kind. */
  label: string;
  /**
   * The tile's own box, sizing only — `w-full h-[74px]`, or `w-full h-full`
   * where the grid pins its rows in pixels itself. The
   * picture and the given-up label are drawn in the same box, so a failure
   * never changes the grid's shape. A pixel height somewhere in the chain,
   * never `aspect-*`: these grids are all `auto-fill`/`minmax`, where a ratio
   * resolves against an indefinite track (`frontend.md`).
   */
  box: string;
  alt?: string;
  /**
   * Load now, not when the tile comes near the screen. For a list that
   * already draws only the cells near its view (Develop's band).
   */
  eager?: boolean;
}

/** The delay before attempt `n` is asked. */
function retryDelay(n: number): number {
  return RETRY_DELAYS_MS[Math.min(n, RETRY_DELAYS_MS.length - 1)] ?? 0;
}

export default function WinnowThumb({ client, id, label, box, alt = '', eager = false }: WinnowThumbProps) {
  const [attempt, setAttempt] = useState(0);
  // Whether the tile is near enough the screen to ask for its picture.
  const [near, setNear] = useState(eager);
  // A round past the first: a tap, the device back online, the tile back in view.
  const [round, setRound] = useState(0);
  const timer = useRef<number | null>(null);
  const stall = useRef<number | null>(null);
  // A heal is awaited, not timed, so the timer cannot speak for it.
  const alive = useRef(true);
  const node = useRef<HTMLElement | null>(null);
  // Whether the tile was on screen at the observer's last word; null before
  // its first. A new round needs a real leave-then-return, not the first
  // sight of a freshly mounted node.
  const wasVisible = useRef<boolean | null>(null);
  const gaveUp = attempt > THUMB_RETRIES;

  const clearTimers = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (stall.current !== null) window.clearTimeout(stall.current);
    timer.current = null;
    stall.current = null;
  };

  // A new picture starts fresh, and a retry still pending for the old one is
  // dropped — on unmount too, so a grid closed mid-retry leaves nothing armed.
  useEffect(() => {
    alive.current = true;
    setAttempt(0);
    setRound(0);
    wasVisible.current = null;
    return () => {
      alive.current = false;
      clearTimers();
    };
  }, [id]);

  // The tile asks for its picture when it comes near the screen — its own
  // observer, never the browser's `loading="lazy"`, which WebKit may never
  // start inside a scroller. A tile that gave up and leaves the screen asks
  // again when it comes back.
  useEffect(() => {
    if (eager) {
      setNear(true);
      return;
    }
    const el = node.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        // Every retry mounts a NEW node (the `key`), and a detached target
        // reads as "not intersecting": only the node on screen has a say,
        // or a give-up's fresh label would read as a return into view.
        const live = entries.filter((e) => e.target === node.current && e.target.isConnected);
        if (!live.length) return;
        const visible = live.some((e) => e.isIntersecting);
        const before = wasVisible.current;
        wasVisible.current = visible;
        if (!visible) return;
        setNear(true);
        if (before === false) {
          // Back in view after having left it: a tile that had given up
          // gets another go.
          setAttempt((a) => (a > THUMB_RETRIES ? 0 : a));
          setRound((r) => Math.min(r + 1, MAX_ROUNDS));
        }
      },
      { rootMargin: NEAR },
    );
    io.observe(el);
    return () => io.disconnect();
    // Re-run on every attempt and round: the node it watches is the one on
    // screen now, never the one a retry replaced.
  }, [eager, id, round, attempt, gaveUp]);

  // One more round when the device comes back online or the page is shown
  // again — the two moments a phone's lost requests become answerable.
  useEffect(() => {
    if (!gaveUp || round >= MAX_ROUNDS) return;
    const again = () => {
      if (!alive.current) return;
      if (document.visibilityState === 'hidden') return;
      setAttempt(0);
      setRound((r) => r + 1);
    };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [gaveUp, round]);

  const fail = useCallback(
    (at: number) => {
      if (!alive.current) return;
      clearTimers();
      if (at === 0) {
        // The first failure is nearly always the cache entry, not the
        // network: replace it and ask for the same URL. When the instance
        // does not answer at all, there is nothing to ask the plain URL for
        // — go straight to a discriminated request.
        void client.heal(client.thumbUrl(id)).then((healed) => {
          if (alive.current) setAttempt(healed ? 1 : 2);
        });
        return;
      }
      const next = at + 1;
      timer.current = window.setTimeout(() => setAttempt(next), retryDelay(next));
    },
    [client, id],
  );

  // Each attempt gets `LOAD_STALL_MS` to say `load` or `error`; one that says
  // neither is treated as lost. Armed when the picture is asked for, cleared
  // by whichever event comes.
  useEffect(() => {
    if (!near || gaveUp) return;
    if (stall.current !== null) window.clearTimeout(stall.current);
    stall.current = window.setTimeout(() => {
      stall.current = null;
      const img = node.current as HTMLImageElement | null;
      if (img && img.complete && img.naturalWidth > 0) return;
      fail(attempt);
    }, LOAD_STALL_MS + attempt * 4000);
    return () => {
      if (stall.current !== null) window.clearTimeout(stall.current);
      stall.current = null;
    };
  }, [near, gaveUp, attempt, round, fail]);

  if (gaveUp) {
    return (
      <div
        ref={(el) => {
          node.current = el;
        }}
        className={`${box} grid place-items-center bg-frame cursor-pointer`}
        title="Tap to ask for this picture again"
        // A tap starts another round. Not a button: the tile around it is one
        // already, and the tap reaches it too, which is right — it is the tile.
        onClick={() => {
          if (round >= MAX_ROUNDS) return;
          setAttempt(0);
          setRound((r) => r + 1);
        }}
      >
        <span className="font-mono text-3xs uppercase tracking-wide text-muted">
          {label}
        </span>
      </div>
    );
  }

  return (
    <img
      // `key` on the attempt: React must build a NEW element, or swapping the
      // src on the failed one can be ignored by the browser.
      key={`${round}:${attempt}`}
      ref={(el) => {
        node.current = el;
      }}
      // No `src` until the tile is near the screen: the observer above is
      // this component's own lazy loading.
      src={near ? client.thumbRetryUrl(id, attempt + round * (THUMB_RETRIES + 1)) : undefined}
      alt={alt}
      // Served with the session cookie, so the browser is told to send it
      // cross-origin. Cross-ORIGIN and same-SITE (`docs/winnow-bridge.md`).
      crossOrigin="use-credentials"
      decoding="async"
      className={`block object-cover ${box}`}
      onLoad={() => {
        if (stall.current !== null) window.clearTimeout(stall.current);
        stall.current = null;
      }}
      onError={() => fail(attempt)}
    />
  );
}
