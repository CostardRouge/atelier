/**
 * Fetching the world's land (`land.ts` is the pure half that reads it) — the
 * `load-gazetteer.ts` split, for its reason: `import.meta.env` exists only
 * inside the bundler.
 *
 * **Nothing is asked at boot.** The file is ~460 kB (~175 kB gzipped over the
 * wire) and it is fetched the first time a trip's map view opens, from our own
 * origin through `BASE_URL` (`deployment.md`: a hardcoded base path already
 * 404'd the whole site once).
 */

import { parseLand, type LandCollection } from './land';

const URL = `${import.meta.env.BASE_URL}geo/land.json`;

/** Cached by promise, so two maps opening at once share one request; a failure is forgotten. */
let pending: Promise<LandCollection> | null = null;

export function loadLand(): Promise<LandCollection> {
  if (!pending) {
    pending = (async () => {
      const res = await fetch(URL);
      if (!res.ok) throw new Error(`the land outline answered ${res.status}`);
      return parseLand(await res.json());
    })().catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}
