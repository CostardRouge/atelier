/**
 * Fetching the city index (`gazetteer.ts` is the pure half that reads it).
 *
 * The split is the one `saved-grade.ts` / `restore-grade.ts` already has, and
 * it is load-bearing rather than tidy: this file touches `import.meta.env`,
 * which only exists inside the bundler, so folding it into the pure module
 * would drag every test that imports the deduction into Vite's world.
 *
 * **Nothing is asked at boot.** The index is 6.5 MB (2.2 MB over the wire,
 * gzipped) and it is fetched the first time a leg needs naming — that is, when
 * the author presses the button, never before. Its URL goes through
 * `import.meta.env.BASE_URL` like every other shipped asset, because a
 * hardcoded base path already drifted on a repo rename and 404'd the whole
 * site (`deployment.md`).
 *
 * **Fetched, parsed and ordered in a WORKER** (`gazetteer-worker.ts`, since
 * 2026-10-06, audit PERF-06): parsing 135 000 rows and sorting the towns by
 * population held the main thread for 364 ms measured headless — a frozen
 * map on a phone the first time it opens. The worker hands the parsed list
 * back (one structured clone, the main thread's remaining share) and the
 * towns' order as a transferred typed array, and is ended at once. Where
 * there is no `Worker` (a test, an old engine) the same work runs here.
 */

import { townsFromOrder, townOrder, type Town } from '../map/pick-map';
import { startTask } from '../tasks/tasks';
import { parseGazetteer, type GazetteerCity } from './gazetteer';
import type { GazetteerAnswer, GazetteerFailure } from './gazetteer-worker';

const URL_PATH = `${import.meta.env.BASE_URL}geo/cities.json`;

/** The index as every reader takes it: the cities, and the towns biggest first (the map's). */
export interface GazetteerIndex {
  cities: GazetteerCity[];
  /** `townsByPopulation(cities)` — the cities themselves, suburbs left out, biggest first. */
  sorted: Town[];
}

/**
 * Cached by PROMISE, not by result, so thirty legs asked for at once share
 * one request — the same reason `restore-grade.ts` caches its builtin LUTs
 * that way. A FAILED fetch is forgotten, so one flaky request does not leave
 * every leg unnamed for the rest of the session.
 */
let pending: Promise<GazetteerIndex> | null = null;
/** The index once it has arrived — what a synchronous reader may take (`townsIfLoaded`). */
let loaded: GazetteerIndex | null = null;

function loadIndex(): Promise<GazetteerIndex> {
  if (!pending) {
    // Said in the masthead's pill (after `SHOW_AFTER_MS`): the first read is
    // 2 MB over the wire and a parse, and a switch that turned grouping on,
    // or a map opening, must not look as if nothing happened.
    const task = startTask({ label: 'Reading the town index' });
    pending = (typeof Worker === 'undefined' ? inThread() : inWorker())
      .then((index) => {
        loaded = index;
        return index;
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      })
      .finally(() => task.done());
  }
  return pending;
}

/**
 * The towns, biggest first, IF the index has already been read in this
 * session — else null, and nothing is asked. For a synchronous reader that
 * names what it draws (an opener's `prepare`, `hookContextFor`): the editor
 * asks for the index when a piece needs it (`loadTowns`), and until it lands
 * the reader falls back and says nothing false.
 */
export function townsIfLoaded(): readonly Town[] | null {
  return loaded?.sorted ?? null;
}

async function inThread(): Promise<GazetteerIndex> {
  const res = await fetch(URL_PATH);
  if (!res.ok) throw new Error(`the city index answered ${res.status}`);
  const cities = parseGazetteer(await res.json());
  return { cities, sorted: townsFromOrder(cities, townOrder(cities)) };
}

function inWorker(): Promise<GazetteerIndex> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./gazetteer-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      // A worker that cannot start (a strict CSP, a file: origin) falls back to this thread.
      resolve(inThread());
      return;
    }
    const done = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<GazetteerAnswer | GazetteerFailure>) => {
      done();
      const answer = event.data;
      if (answer.ok) resolve({ cities: answer.cities, sorted: townsFromOrder(answer.cities, answer.order) });
      else reject(new Error(answer.error));
    };
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message || 'the city index could not be read'));
    };
    // The worker resolves nothing: the page's own absolute URL crosses, so a
    // relative base never lands under the worker's script.
    worker.postMessage({ url: new URL(URL_PATH, location.href).href });
  });
}

export function loadGazetteer(): Promise<GazetteerCity[]> {
  return loadIndex().then((index) => index.cities);
}

/** The index with its towns ordered once — what the maps draw their names from. */
export function loadTowns(): Promise<GazetteerIndex> {
  return loadIndex();
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
