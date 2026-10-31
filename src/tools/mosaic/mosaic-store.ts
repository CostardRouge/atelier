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
