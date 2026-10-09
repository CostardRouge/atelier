/**
 * The shipped coastline as a TERRAIN index (`terrain.ts`), read once a
 * session — the `load-gazetteer.ts` pattern: a synchronous reader takes what
 * has arrived (`landIfLoaded`), and the editor asks for it when a piece
 * needs it (`loadLandIndex`), then rebuilds its context when it lands.
 *
 * Nothing is asked at boot: the file is the trip map's own (`load-land.ts`),
 * fetched from our own origin the first time either needs it.
 */

import { loadLand } from './load-land';
import { landIndex, type LandIndex } from './terrain';

let index: LandIndex | null = null;
let pending: Promise<LandIndex> | null = null;

/** The coastline's index once it has arrived; null before. */
export function landIfLoaded(): LandIndex | null {
  return index;
}

/** Fetch and index the coastline, once; a failure is forgotten so a later ask retries. */
export function loadLandIndex(): Promise<LandIndex> {
  if (index) return Promise.resolve(index);
  if (!pending) {
    pending = loadLand()
      .then((land) => (index = landIndex(land)))
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
