/**
 * OpenStreetMap tiles KEPT ON THIS DEVICE (2026-10-07, his «build the
 * IndexedDB tile cache», the proposal left open by the streamed ground).
 *
 * A following camera's pyramid is thousands of tiles (`tile-strip.ts`); the
 * tab's own memory cache dies with the tab, so reopening a piece tomorrow,
 * or exporting it a second time, asked the volunteer-run server for every
 * one again — the very thing OSM's tile usage policy asks a client not to
 * do. Here each tile's BLOB (the PNG the server sent, 20–40 kB) is kept in
 * its own IndexedDB database, `atelier-tiles`, keyed `z/x/y`:
 *
 * - drawn without asking for a month (`TILE_FRESH_MS`), asked again after —
 *   and drawn from the kept copy anyway if the server cannot answer;
 * - bounded by bytes (`tileCacheBudget()`: 256 MB on a computer, 64 MB on a
 *   phone), the least recently used leaving first, the eviction run after a
 *   burst of writes rather than on each;
 * - ONLY tiles this device fetched with its own yes (`osm-tiles.ts`), and
 *   CLEARED when that yes is taken back — consent and what it fetched go
 *   together; a verb in the background row clears it at any time.
 *
 * Map tiles are the third party's public map, not media: nothing of a trip,
 * a picture or a position is written here — a tile's address is all the key
 * says, and the area it reveals is already what the request revealed. Every
 * storage failure (a private window, a quota) degrades to the network, never
 * to an error.
 */

import { useSyncExternalStore } from 'react';
import { isConstrainedDevice } from '../lib/device-class';
import {
  TILE_CACHE_BYTES,
  TILE_CACHE_BYTES_CONSTRAINED,
  evictionOrder,
  isFresh,
  shouldTouch,
  type KeptTileMeta,
} from './tile-cache-policy';

const DB_NAME = 'atelier-tiles';
const STORE = 'tiles';
const BY_USE = 'used';

interface KeptTile extends KeptTileMeta {
  blob: Blob;
}

/** The bytes the cache may hold on this device. */
export function tileCacheBudget(): number {
  return isConstrainedDevice() ? TILE_CACHE_BYTES_CONSTRAINED : TILE_CACHE_BYTES;
}

let opening: Promise<IDBDatabase | null> | null = null;

/** The database, or null where this browser keeps none (a private window, a test). */
function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  const held: Promise<IDBDatabase | null> = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' }).createIndex(BY_USE, 'used');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // A database the browser closes (storage cleared, a newer version
        // elsewhere) is opened again on the next read, not failed forever.
        const forget = () => {
          if (opening === held) opening = null;
        };
        db.onversionchange = () => {
          db.close();
          forget();
        };
        db.onclose = forget;
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  opening = held;
  return held;
}

/**
 * The kept blob of tile `key` (`z/x/y`), and whether it is fresh enough to
 * draw without asking; null when none is kept.
 */
export async function readTile(key: string, now = Date.now()): Promise<{ blob: Blob; fresh: boolean } | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const kept = await new Promise<KeptTile | null>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as KeptTile | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
    if (!kept) return null;
    if (shouldTouch(kept.used, now)) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...kept, used: now });
    }
    return { blob: kept.blob, fresh: isFresh(kept.at, now) };
  } catch {
    return null;
  }
}

/** Keep the blob of tile `key`; an eviction follows a burst of writes. */
export async function writeTile(key: string, blob: Blob, now = Date.now()): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, blob, size: blob.size, at: now, used: now } satisfies KeptTile);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    scheduleEviction();
    changed();
  } catch {
    /* the network answers next time */
  }
}

/** After this long without a write, the cache is brought under its budget. */
const EVICT_AFTER_MS = 2000;
let evictTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleEviction(): void {
  if (evictTimer !== null) clearTimeout(evictTimer);
  evictTimer = setTimeout(() => {
    evictTimer = null;
    void evict();
  }, EVICT_AFTER_MS);
}

/** Every kept tile's size and dates — the blobs themselves are not read. */
async function metas(db: IDBDatabase): Promise<KeptTileMeta[]> {
  return new Promise((resolve) => {
    const out: KeptTileMeta[] = [];
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).index(BY_USE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      const { key, size, at, used } = cursor.value as KeptTile;
      out.push({ key, size, at, used });
      cursor.continue();
    };
    req.onerror = () => resolve(out);
  });
}

/** Bring the cache under its budget, least recently used first. */
export async function evict(budget = tileCacheBudget()): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  try {
    const gone = evictionOrder(await metas(db), budget);
    if (!gone.length) return 0;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const key of gone) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    changed();
    return gone.length;
  } catch {
    return 0;
  }
}

/** Forget every kept tile — the background row's verb, and taking the consent back. */
export async function clearTiles(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* nothing kept to forget */
  }
  changed();
}

// --- what the panel says ------------------------------------------------------------

export interface TileCacheSize {
  tiles: number;
  bytes: number;
}

const listeners = new Set<() => void>();
let size: TileCacheSize | null = null;
let measuring = false;
/** A change landed while measuring: measure once more when done. */
let again = false;
let measureTimer: ReturnType<typeof setTimeout> | null = null;

/** Measured on demand and after changes, a burst at a time. */
function measure(): void {
  if (measuring) {
    again = true;
    return;
  }
  measuring = true;
  void (async () => {
    const db = await openDb();
    const all = db ? await metas(db).catch(() => []) : [];
    size = { tiles: all.length, bytes: all.reduce((sum, t) => sum + t.size, 0) };
    measuring = false;
    for (const listener of listeners) listener();
    if (again) {
      again = false;
      measure();
    }
  })();
}

function changed(): void {
  // Nobody reading: the next reader measures afresh rather than see the old count.
  if (!listeners.size) {
    size = null;
    return;
  }
  if (measureTimer !== null) clearTimeout(measureTimer);
  measureTimer = setTimeout(() => {
    measureTimer = null;
    measure();
  }, 500);
}

/** What the cache holds on this device, as React state — null until measured. */
export function useTileCacheSize(): TileCacheSize | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (size === null) measure();
      return () => listeners.delete(listener);
    },
    () => size,
    () => null,
  );
}
