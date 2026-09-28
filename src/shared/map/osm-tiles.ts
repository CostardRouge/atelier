/**
 * OpenStreetMap tiles drawn INTO an opener — fetched, stitched and laid onto
 * the openers' projection, for the preview and the exported file alike
 * (2026-09-28, the maintainer: «the case we want the map background in the
 * export, and the preview as well»).
 *
 * It is the suite's tiles exception, used once more and under the same
 * rules: nothing at boot, nothing implicit, the third-party URL in this
 * folder beside `track-map.ts`, and the CONSENT kept on this machine
 * (`localStorage`), never on the trip — a piece may ask for its background,
 * but a trip opened on another device, or from someone else's backup, fetches
 * nothing until that device says yes. The same switch the flight map words
 * (`TILES_TOGGLE`) explains what it reveals.
 *
 * What is fetched is small and kept: a region's tiles (at most `MAX_TILES`),
 * the blobs cached for the tab, so a slider dragged on the opener never asks
 * again. The drawing carries the credit the licence requires — that is the
 * painters' job (`paintOsmCredit`), and it rides into every export.
 */

import { useSyncExternalStore } from 'react';
import { columnSource, planTiles, rowSource, TILE_PX, type GeoBox } from './tile-math';
import { OSM_CREDIT, OSM_TILES } from './track-map';

const KEY = 'atelier.map.tilesInOpeners';
/** The most tiles one background asks for — a softer map past it, never more requests. */
export const MAX_TILES = 64;
/** How many tile blobs the tab keeps (~30 kB each). */
const CACHE_TILES = 400;

// --- consent -----------------------------------------------------------------

const listeners = new Set<() => void>();

function readAllowed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    // Private mode, blocked storage: "no", the safe way for consent to fail.
    return false;
  }
}

let allowed: boolean | null = null;

/** Whether this device lets an opener fetch its map background. */
export function tilesAllowed(): boolean {
  if (allowed === null) allowed = readAllowed();
  return allowed;
}

/** Say yes or no for this device. Never written on a document. */
export function allowTiles(on: boolean): void {
  allowed = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* holds for the session */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The consent, as React state every reader shares. */
export function useTilesAllowed(): boolean {
  return useSyncExternalStore(subscribe, tilesAllowed, () => false);
}

/** What the switch says before anything leaves, and what it costs the picture. */
export const TILES_IN_OPENER_NOTICE =
  'Fetches map tiles from OpenStreetMap for this region — it reveals the area to its tile server, ' +
  'from this device only. The tiles are drawn into the preview and the exported file, credited ' +
  `«${OSM_CREDIT}» as the licence requires.`;

// --- tiles -------------------------------------------------------------------

const blobs = new Map<string, Promise<Blob>>();

function tileUrl(z: number, x: number, y: number): string {
  return OSM_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

function fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<Blob> {
  const url = tileUrl(z, x, y);
  let pending = blobs.get(url);
  if (!pending) {
    pending = fetch(url, { mode: 'cors', signal }).then((res) => {
      if (!res.ok) throw new Error(`the tile server answered ${res.status}`);
      return res.blob();
    });
    pending.catch(() => blobs.delete(url));
    blobs.set(url, pending);
    // Oldest first: a Map iterates in insertion order.
    while (blobs.size > CACHE_TILES) blobs.delete(blobs.keys().next().value as string);
  }
  return pending;
}

/**
 * The region as ONE raster where latitude and longitude are both linear —
 * what an opener draws with a single affine `drawImage`. The mosaic is
 * fetched four tiles at a time, stitched, and re-laid row by row out of
 * Web Mercator (`tile-math.ts`). Throws with a sentence a person can act on.
 */
export async function loadBasemap(
  box: GeoBox,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  if (!tilesAllowed()) throw new Error('The OpenStreetMap background is not allowed on this device.');
  const plan = planTiles(box, width, height, { maxTiles: MAX_TILES });
  if (!plan) throw new Error('This region cannot be drawn from tiles in one piece (it crosses the 180th meridian).');

  const cols = plan.x1 - plan.x0 + 1;
  const rows = plan.y1 - plan.y0 + 1;
  const mosaic = new OffscreenCanvas(cols * TILE_PX, rows * TILE_PX);
  const mg = mosaic.getContext('2d');
  if (!mg) throw new Error('This browser cannot draw the map background.');

  const jobs: { x: number; y: number }[] = [];
  for (let y = plan.y0; y <= plan.y1; y++) for (let x = plan.x0; x <= plan.x1; x++) jobs.push({ x, y });
  let failed = 0;
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      if (signal?.aborted) return;
      try {
        const bitmap = await createImageBitmap(await fetchTile(plan.z, job.x, job.y, signal));
        mg.drawImage(bitmap, (job.x - plan.x0) * TILE_PX, (job.y - plan.y0) * TILE_PX);
        bitmap.close();
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (failed === plan.count) {
    throw new Error('OpenStreetMap could not be reached — the map is drawn without its background.');
  }

  const out = new OffscreenCanvas(width, height);
  const og = out.getContext('2d');
  if (!og) throw new Error('This browser cannot draw the map background.');
  og.imageSmoothingQuality = 'high';
  const { sx, sw } = columnSource(box, plan);
  for (let r = 0; r < height; r++) {
    const { sy, sh } = rowSource(box, plan, r, height);
    og.drawImage(mosaic, sx, sy, sw, sh, 0, r, width, 1);
  }
  return out.transferToImageBitmap();
}
