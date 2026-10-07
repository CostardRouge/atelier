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
 * What is fetched is bounded and kept: a region's tiles (at most `MAX_TILES`;
 * a following camera's pyramid `stripBudget()` more, over the whole drive —
 * `tile-strip.ts`), the blobs cached for the tab, so a slider dragged on the
 * opener never asks again, and KEPT on this device for a month
 * (`tile-cache.ts`, his call of 2026-10-07), so a piece reopened tomorrow or
 * exported twice asks the server nothing — forgotten with the consent. The drawing carries the credit the licence
 * requires — that is the painters' job (`paintOsmCredit`), and it rides into
 * every export.
 */

import { useSyncExternalStore } from 'react';
import { isConstrainedDevice } from '../lib/device-class';
import { columnSource, planTiles, rowSource, TILE_PX, type GeoBox } from './tile-math';
import { STREAM_DECODED, STREAM_DECODED_CONSTRAINED, STRIP_TILES, STRIP_TILES_CONSTRAINED } from './tile-strip';
import { OSM_CREDIT, OSM_TILES } from './track-map';
import { clearTiles, readTile, writeTile } from './tile-cache';

const KEY = 'atelier.map.tilesInOpeners';
/** The most tiles one background asks for — a softer map past it, never more requests. */
export const MAX_TILES = 64;
/** Tiles fetched side by side for one raster — and, across the pyramid's tiles, in all. */
export const TILE_WORKERS = 4;
/**
 * How many tile blobs the tab keeps (~30 kB each): a wide raster and a
 * computer's pyramid, with room for a slider's step before the last.
 */
const CACHE_TILES = 768;
/**
 * A tile that has not answered by then is a failure, not a wait: an export
 * awaits every tile it will draw, and a server that hangs must not hang it.
 */
const TILE_TIMEOUT_MS = 20_000;

/** The tiles a following camera's pyramid may FETCH on this device — requests, and compressed blobs it keeps. */
export function stripBudget(): number {
  return isConstrainedDevice() ? STRIP_TILES_CONSTRAINED : STRIP_TILES;
}

/** The pyramid tiles this device keeps DECODED at once around the playhead — 256 kB bitmaps. */
export function decodedBudget(): number {
  return isConstrainedDevice() ? STREAM_DECODED_CONSTRAINED : STREAM_DECODED;
}

/** The tab's tile blobs by URL, a request in flight shared by every asker. */
const blobs = new Map<string, Promise<Blob>>();

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

/**
 * Say yes or no for this device. Never written on a document. A no also
 * forgets the tiles this device kept (`tile-cache.ts`): what the yes fetched
 * goes with it.
 */
export function allowTiles(on: boolean): void {
  allowed = on;
  if (!on) {
    // The tab's copies go too: a no means nothing fetched is drawn again.
    blobs.clear();
    void clearTiles();
  }
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

function tileUrl(z: number, x: number, y: number): string {
  return OSM_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

function fetchTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<Blob> {
  const url = tileUrl(z, x, y);
  let pending = blobs.get(url);
  if (!pending) {
    pending = keptOrFetched(`${z}/${x}/${y}`, url, signal);
    pending.catch(() => blobs.delete(url));
    blobs.set(url, pending);
    // Oldest first: a Map iterates in insertion order.
    while (blobs.size > CACHE_TILES) blobs.delete(blobs.keys().next().value as string);
  }
  return pending;
}

/**
 * A tile from the device's own cache when it is fresh (`tile-cache.ts`),
 * else from the server — kept for next time — and, when the server cannot
 * answer, the stale copy rather than nothing.
 */
async function keptOrFetched(key: string, url: string, signal?: AbortSignal): Promise<Blob> {
  const kept = await readTile(key);
  if (kept?.fresh) return kept.blob;
  try {
    const blob = await fromServer(url, signal);
    // A tile that lands after the yes was taken back is drawn by whoever
    // asked, never kept: `allowTiles(false)` has already cleared the cache.
    if (tilesAllowed()) void writeTile(key, blob);
    return blob;
  } catch (err) {
    if (kept && !signal?.aborted) return kept.blob;
    throw err;
  }
}

function fromServer(url: string, signal?: AbortSignal): Promise<Blob> {
  // The caller's cancel and the timeout, joined by hand: `AbortSignal.any`
  // and `.timeout` are younger than the Safari this suite still serves.
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TILE_TIMEOUT_MS);
  if (signal?.aborted) stop.abort();
  signal?.addEventListener('abort', () => stop.abort(), { once: true });
  return fetch(url, { mode: 'cors', signal: stop.signal })
    .then((res) => {
      if (!res.ok) throw new Error(`the tile server answered ${res.status}`);
      return res.blob();
    })
    .finally(() => clearTimeout(timer));
}

/**
 * The region as ONE raster where latitude and longitude are both linear —
 * what an opener draws with a single affine `drawImage`. The mosaic is
 * fetched `TILE_WORKERS` tiles at a time, stitched, and re-laid row by row
 * out of Web Mercator (`tile-math.ts`). A `zoom` given is fetched as it is
 * (a strip's patch, one tile — `workers` lets the caller run several such
 * loads side by side without multiplying the connections). Throws with a
 * sentence a person can act on.
 */
export async function loadBasemap(
  box: GeoBox,
  width: number,
  height: number,
  signal?: AbortSignal,
  zoom?: number,
  workers = TILE_WORKERS,
): Promise<ImageBitmap> {
  if (!tilesAllowed()) throw new Error('The OpenStreetMap background is not allowed on this device.');
  const plan = planTiles(box, width, height, { maxTiles: MAX_TILES, zoom });
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
  await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
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

/** How many zooms a pyramid tile falls back through before the wide raster stands in alone. */
const COARSER_TRIES = 2;

/**
 * The blob of one tile of a following camera's pyramid (`tile-strip.ts`) —
 * or, when that tile cannot be fetched, of its PARENT, then its grandparent:
 * the next coarser level, cut and enlarged at decode, rather than a hole in
 * a recorded file. `zoom` says which landed. Throws only when none did, and
 * then the coarser ground under it stands in.
 */
export async function fetchPatch(
  tile: { z: number; x: number; y: number },
  signal?: AbortSignal,
): Promise<{ blob: Blob; zoom: number }> {
  if (!tilesAllowed()) throw new Error('The OpenStreetMap background is not allowed on this device.');
  let last: unknown = null;
  for (let up = 0; up <= COARSER_TRIES && tile.z - up >= 0; up++) {
    try {
      return { blob: await fetchTile(tile.z - up, tile.x >> up, tile.y >> up, signal), zoom: tile.z - up };
    } catch (err) {
      if (signal?.aborted) throw err;
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('OpenStreetMap could not be reached.');
}

/**
 * Bands a decoded tile is re-laid out of Mercator in. Inside one tile the
 * stretch is all but linear (under a pixel in 32 bands at the coarsest level
 * a pyramid draws), and a band per row — the wide raster's way — is 256
 * draws a tile, which a streamed ground pays on the playhead's path.
 */
const PATCH_BANDS = 32;

/**
 * One pyramid tile as a `TILE_PX` raster with latitude and longitude both
 * linear over its own box, decoded from `blob` — the tile at `zoom`, its
 * own or an ancestor's (`fetchPatch`), cut to the box and re-laid in bands.
 * The mosaic is that ONE fetched tile, so the plan is built on its own
 * column and row: a plan derived from the box can round the box's west edge
 * a hair under the tile's and start a column early — which drew a
 * transparent tile, the wide raster showing through (seen headless).
 */
export async function decodePatch(
  blob: Blob,
  zoom: number,
  tile: { z: number; x: number; y: number },
  box: GeoBox,
): Promise<ImageBitmap> {
  const up = tile.z - zoom;
  const x = tile.x >> up;
  const y = tile.y >> up;
  const plan = { z: zoom, x0: x, x1: x, y0: y, y1: y, count: 1 };
  const source = await createImageBitmap(blob);
  try {
    const out = new OffscreenCanvas(TILE_PX, TILE_PX);
    const og = out.getContext('2d');
    if (!og) throw new Error('This browser cannot draw the map background.');
    og.imageSmoothingQuality = 'high';
    const { sx, sw } = columnSource(box, plan);
    const band = TILE_PX / PATCH_BANDS;
    for (let b = 0; b < PATCH_BANDS; b++) {
      const top = rowSource(box, plan, b * band, TILE_PX);
      const bottom = rowSource(box, plan, (b + 1) * band - 1, TILE_PX);
      og.drawImage(source, sx, top.sy, sw, bottom.sy + bottom.sh - top.sy, 0, b * band, TILE_PX, band);
    }
    return out.transferToImageBitmap();
  } finally {
    source.close();
  }
}
