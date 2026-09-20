/**
 * Fetching the city index (`gazetteer.ts` is the pure half that reads it).
 *
 * The split is the one `saved-grade.ts` / `restore-grade.ts` already has, and
 * it is load-bearing rather than tidy: this file touches `import.meta.env`,
 * which only exists inside the bundler, so folding it into the pure module
 * would drag every test that imports the deduction into Vite's world.
 *
 * **Nothing is asked at boot.** The index is 5.5 MB (2.2 MB over the wire,
 * gzipped) and it is fetched the first time a leg needs naming — that is, when
 * the author presses the button, never before. Its URL goes through
 * `import.meta.env.BASE_URL` like every other shipped asset, because a
 * hardcoded base path already drifted on a repo rename and 404'd the whole
 * site (`deployment.md`).
 */

import { parseGazetteer, type GazetteerCity } from './gazetteer';

const URL = `${import.meta.env.BASE_URL}geo/cities.json`;

/**
 * Cached by PROMISE, not by result, so thirty legs asked for at once share
 * one request — the same reason `restore-grade.ts` caches its builtin LUTs
 * that way. A FAILED fetch is forgotten, so one flaky request does not leave
 * every leg unnamed for the rest of the session.
 */
let pending: Promise<GazetteerCity[]> | null = null;

export function loadGazetteer(): Promise<GazetteerCity[]> {
  if (!pending) {
    pending = (async () => {
      const res = await fetch(URL);
      if (!res.ok) throw new Error(`the city index answered ${res.status}`);
      return parseGazetteer(await res.json());
    })().catch((error) => {
      pending = null;
      throw error;
    });
  }
  return pending;
}

/**
 * The index, or an empty one — for the callers whose job survives having no
 * name to offer. A leg with no place keeps its dates and says so, which is
 * the honest outcome and not an error to report twice.
 */
export async function gazetteerOrEmpty(): Promise<GazetteerCity[]> {
  try {
    return await loadGazetteer();
  } catch {
    return [];
  }
}
