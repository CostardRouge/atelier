/**
 * IndexedDB persistence for the Mosaic instrument — the atlas store's shape
 * (`atlas/atlas-store.ts`): hand-rolled, promise wrappers, every entry point
 * degrading rather than throwing, because the browser may deny or evict
 * storage and the tool must keep working in memory when it does.
 *
 * Its own database, `atelier-mosaic`, so a schema bump here never forces an
 * upgrade on another tool's. Six stores, all created at v1 (`docs/mosaic.md`
 * §3):
 *
 * - `mosaics` — the documents (`shared/mosaic/mosaic-doc.ts`), read through
 *   `readMosaicDoc` (M3);
 * - `measures` — a picture's 6 × 6 grid (base64) keyed by `<source>:<asset>`,
 *   shared by every mosaic of this device: adding the same day to a second
 *   mosaic measures nothing;
 * - `tiles` — the 160 × 90 JPEG a cell DRAWS, same key: the sixth case of
 *   media bytes kept on the device (`local-first.md`, «Persistence»), his
 *   pick, said in the legal notice; pruned to what the device's mosaics
 *   reference when one is deleted (M3);
 * - `thumbs` — one poster per mosaic, the gallery card's cover (M3);
 * - `sync` — one record per mosaic kept on an instance (M8), created now so
 *   keeping a mosaic on a Winnow adds no upgrade;
 * - `kv` — small per-device marks.
 */

import type { SyncRecord } from '../../shared/sources/doc-sync';
import { readMosaicDoc, type MosaicDoc } from '../../shared/mosaic/mosaic-doc';

const DB_NAME = 'atelier-mosaic';
const DB_VERSION = 1;
const MOSAICS = 'mosaics';
const MEASURES = 'measures';
const TILES = 'tiles';
const THUMBS = 'thumbs';
const SYNC = 'sync';
const KV = 'kv';
const STORES = [MOSAICS, MEASURES, TILES, THUMBS, SYNC, KV];

interface MeasureRecord {
  /** The grid in base64 (`measure.ts`). */
  grid: string;
  measuredAt: number;
}

/** The key a picture's measure and tile are filed under. */
export const measureKey = (sourceId: string, assetId: number): string => `${sourceId}:${assetId}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Several puts in one transaction; resolves when it commits. */
async function putMany(store: string, entries: Iterable<[string, unknown]>): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const s = tx.objectStore(store);
      for (const [key, value] of entries) s.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** A write transaction over `stores`; true once it committed, false when the browser refused. */
async function write(stores: string | string[], fn: (tx: IDBTransaction) => void): Promise<boolean> {
  try {
    const db = await openDb();
    try {
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction(stores, 'readwrite');
        fn(tx);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      });
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

// ---- mosaics ----

/** Every mosaic on this device, newest first. */
export async function listMosaics(): Promise<MosaicDoc[]> {
  try {
    const raw = await withStore<unknown[]>(MOSAICS, 'readonly', (s) => s.getAll());
    return raw.flatMap((r) => readMosaicDoc(r, 'local') ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getMosaic(id: string): Promise<MosaicDoc | null> {
  try {
    const raw = await withStore<unknown>(MOSAICS, 'readonly', (s) => s.get(id));
    return raw ? readMosaicDoc(raw, 'local') : null;
  } catch {
    return null;
  }
}

/** False when the browser refused it — said on screen, never swallowed. */
export function putMosaic(doc: MosaicDoc): Promise<boolean> {
  return write(MOSAICS, (tx) => tx.objectStore(MOSAICS).put(doc, doc.id));
}

/**
 * The mosaic, its poster and its sync record — then every tile and measure
 * no mosaic of this device references any more.
 */
export async function deleteMosaic(doc: MosaicDoc): Promise<boolean> {
  const ok = await write([MOSAICS, THUMBS, SYNC], (tx) => {
    tx.objectStore(MOSAICS).delete(doc.id);
    tx.objectStore(THUMBS).delete(doc.id);
    tx.objectStore(SYNC).delete(doc.id);
  });
  if (ok) await pruneToMosaics();
  return ok;
}

/** Drop the tiles and measures no mosaic of this device references. */
export async function pruneToMosaics(): Promise<void> {
  const keep = new Set<string>();
  for (const m of await listMosaics()) if (m.instance) for (const t of m.tiles) keep.add(measureKey(m.instance, t.id));
  await pruneToKeys(keep);
}

// ---- posters ----

export async function getThumb(id: string): Promise<Blob | null> {
  try {
    const v = await withStore<unknown>(THUMBS, 'readonly', (s) => s.get(id));
    return v instanceof Blob ? v : null;
  } catch {
    return null;
  }
}

export function putThumb(id: string, blob: Blob): Promise<boolean> {
  return write(THUMBS, (tx) => tx.objectStore(THUMBS).put(blob, id));
}

// ---- sync records (M8) ----

export async function getSyncRecord(id: string): Promise<SyncRecord | null> {
  try {
    return ((await withStore<unknown>(SYNC, 'readonly', (s) => s.get(id))) as SyncRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

export function putSyncRecord(rec: SyncRecord): Promise<boolean> {
  return write(SYNC, (tx) => tx.objectStore(SYNC).put(rec, rec.id));
}

export function deleteSyncRecord(id: string): Promise<boolean> {
  return write(SYNC, (tx) => tx.objectStore(SYNC).delete(id));
}

// ---- small values ----

export async function getValue<T>(key: string): Promise<T | null> {
  try {
    return ((await withStore<unknown>(KV, 'readonly', (s) => s.get(key))) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export function setValue(key: string, value: unknown): Promise<boolean> {
  return write(KV, (tx) => tx.objectStore(KV).put(value, key));
}

// ---- the device's storage ----

export interface StorageState {
  /** Bytes this site uses, all its databases together; null where the browser does not say. */
  usage: number | null;
  quota: number | null;
  /** The browser promised not to clear it on its own. */
  persisted: boolean;
  canPersist: boolean;
}

export async function storageState(): Promise<StorageState> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  let usage: number | null = null;
  let quota: number | null = null;
  let persisted = false;
  try {
    const est = await storage?.estimate?.();
    usage = typeof est?.usage === 'number' ? est.usage : null;
    quota = typeof est?.quota === 'number' ? est.quota : null;
  } catch {
    /* unsaid */
  }
  try {
    persisted = (await storage?.persisted?.()) ?? false;
  } catch {
    /* unsaid */
  }
  return { usage, quota, persisted, canPersist: typeof storage?.persist === 'function' };
}

/** Ask the browser not to clear this site's data on its own; true when it agreed. */
export async function askPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// ---- measures ----

/**
 * The grids this device already holds for `ids` on `sourceId` — what a run
 * need not fetch again. Empty when storage is unusable.
 */
export async function getMeasures(sourceId: string, ids: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!ids.length) return out;
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(MEASURES, 'readonly');
        const s = tx.objectStore(MEASURES);
        for (const id of ids) {
          const req = s.get(measureKey(sourceId, id));
          req.onsuccess = () => {
            const rec = req.result as MeasureRecord | undefined;
            if (rec && typeof rec.grid === 'string') out.set(id, rec.grid);
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Storage unusable: nothing is remembered, everything is fetched.
  }
  return out;
}

/** Grids measured, kept for every mosaic of this device. Silent when storage refuses. */
export async function putMeasures(sourceId: string, grids: ReadonlyMap<number, string>, now: number = Date.now()): Promise<void> {
  if (!grids.size) return;
  try {
    const entries: [string, MeasureRecord][] = [];
    for (const [id, grid] of grids) entries.push([measureKey(sourceId, id), { grid, measuredAt: now }]);
    await putMany(MEASURES, entries);
  } catch {
    // Kept in the document anyway.
  }
}

// ---- tiles ----

/** The 160 × 90 tile kept for a picture, or undefined. */
export async function getTile(sourceId: string, id: number): Promise<Blob | undefined> {
  try {
    const v = await withStore<unknown>(TILES, 'readonly', (s) => s.get(measureKey(sourceId, id)));
    return v instanceof Blob ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Tiles kept, several at once. Silent when storage refuses: the cell then fetches the thumbnail. */
export async function putTiles(sourceId: string, tiles: ReadonlyMap<number, Blob>): Promise<void> {
  if (!tiles.size) return;
  try {
    const entries: [string, Blob][] = [];
    for (const [id, blob] of tiles) entries.push([measureKey(sourceId, id), blob]);
    await putMany(TILES, entries);
  } catch {
    // The cell fetches it again.
  }
}

/** Which of `ids` have a tile kept here. */
export async function heldTiles(sourceId: string, ids: readonly number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (!ids.length) return out;
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(TILES, 'readonly');
        const s = tx.objectStore(TILES);
        for (const id of ids) {
          const req = s.getKey(measureKey(sourceId, id));
          req.onsuccess = () => {
            if (req.result !== undefined) out.add(id);
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Nothing held.
  }
  return out;
}

/**
 * Every tile and measure whose key is not in `keep` goes — what a deleted
 * mosaic leaves behind, pruned to what the device's other mosaics reference.
 */
export async function pruneToKeys(keep: ReadonlySet<string>): Promise<void> {
  for (const store of [TILES, MEASURES]) {
    try {
      const keys = (await withStore<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys())) as string[];
      const gone = keys.filter((k) => typeof k === 'string' && !keep.has(k));
      if (!gone.length) continue;
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, 'readwrite');
          const s = tx.objectStore(store);
          for (const k of gone) s.delete(k);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    } catch {
      // Left for the next prune.
    }
  }
}

/** Everything kept of pictures gone — the gallery's Forget. */
export async function clearMeasuresAndTiles(): Promise<void> {
  for (const store of [TILES, MEASURES]) {
    try {
      await withStore(store, 'readwrite', (s) => s.clear());
    } catch {
      // Storage unusable: there is nothing kept to clear.
    }
  }
}

/** How many tiles are kept and how many bytes they weigh — the settings' storage line. */
export async function tileStorage(): Promise<{ count: number; bytes: number }> {
  try {
    const all = (await withStore<unknown[]>(TILES, 'readonly', (s) => s.getAll())) as unknown[];
    let bytes = 0;
    for (const v of all) if (v instanceof Blob) bytes += v.size;
    return { count: all.length, bytes };
  } catch {
    return { count: 0, bytes: 0 };
  }
}
