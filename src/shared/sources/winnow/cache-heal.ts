/**
 * Replacing a cached answer that this origin is not allowed to read.
 *
 * **The bug, measured 2026-09-21 in Chromium against a two-origin stub.**
 * Winnow serves its derivatives `immutable` for a year and adds
 * `Access-Control-Allow-Origin` only when the request carried an `Origin` —
 * with no `Vary: Origin` to tell the two answers apart. Chrome partitions its
 * HTTP cache by SITE, and `winnow.steeve.website` and `atelier.steeve.website`
 * are one site, so the two share every entry. Browse Winnow's own pages and
 * its `<img>` tags fetch `/api/assets/<id>/thumb` with no `Origin`; the answer
 * is stored WITHOUT the CORS headers, and from then on Atelier's own request
 * for that URL is served that entry and fails the CORS check before it ever
 * reaches the network. An `<img>` fires `error`; a `fetch` throws a TypeError,
 * which this client can only read as "the instance did not answer" — the
 * sentence the maintainer reported. It never heals: the request never leaves
 * the machine, so a reload changes nothing and only DevTools' *Disable cache*
 * (which is how he found it) or a year makes it stop. It is per-device, which
 * is why the same album opened on his other computer.
 *
 * **The cure, measured the same way.** `fetch(url, { cache: 'reload' })` goes
 * to the network and REPLACES the entry, and the replacement carries the CORS
 * headers: afterwards the plain URL loads from cache for an `<img>` and a
 * `fetch` alike. It costs one request, once, and leaves the cache doing its
 * job — the maintainer's own condition ("le cache est utile"). The `?retry=N`
 * discriminator `WinnowThumb` has carried since the first report only routes
 * AROUND the bad entry: it works, and it leaves the poison in place, so the
 * next page load pays the same failure again.
 *
 * The root fix is `Vary: Origin` on Winnow's derivative routes — measured to
 * prevent the whole thing — and it lives in that repository, not this one.
 * This module is what makes Atelier survive an instance that does not have it.
 *
 * Kept apart from the client so the grids, the lightbox and the client itself
 * share ONE memo: a URL is healed once per session, whatever asked for it.
 */

/** The request that replaces the entry — the caller owns the credentials. */
export type HealRun = () => Promise<Response>;

/** One answer per URL per session, so fifty tiles never heal the same one twice. */
const attempts = new Map<string, Promise<boolean>>();

/**
 * Ask for `url` again past this browser's cache, and say whether the entry now
 * holds an answer worth retrying. False for anything else — offline, a 401, a
 * 404: those are not cured by asking twice, and the caller should say so
 * rather than loop.
 */
export function healCachedUrl(url: string, run: HealRun): Promise<boolean> {
  const held = attempts.get(url);
  if (held) return held;
  const attempt = run().then(
    (res) => res.ok,
    () => false,
  );
  attempts.set(url, attempt);
  return attempt;
}

/** Whether this session has already tried to heal `url`. */
export function wasHealed(url: string): boolean {
  return attempts.has(url);
}

/** Forget every attempt — for tests, and for a connection that is re-made. */
export function forgetHealedUrls(): void {
  attempts.clear();
}
