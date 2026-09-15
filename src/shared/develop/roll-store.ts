/**
 * IndexedDB persistence for the Develop tool — the trip store's shape
 * (`roadtrip/trip-store.ts`): hand-rolled, promise wrappers, every entry point
 * degrading rather than throwing, because the browser may deny or evict
 * storage and the tool must keep working in memory when it does.
 *
 * Its own database, `atelier-develop`, for the reason the trips have theirs:
 * separate documents, separate versions, and a schema bump on one must never
 * force an upgrade transaction on another. Four stores, all created at v1 so
 * the phases after this one add no upgrade:
 *
 * - `rolls` — the documents (`roll-types.ts`), migrated on read;
 * - `thumbs` — one small JPEG per PICTURE, the filmstrip's and the gallery
 *   card's, apart from the documents because they are the only heavy values
 *   and a roll is read on every gallery render;
 * - `sync` — one record per roll kept on an instance (`sources/doc-sync.ts`),
 *   beside the document and never on it;
 * - `presets` — the personal preset book every Develop host shares (D4 of
 *   `docs/develop-tool.md`), one row.
 */

import type { SyncRecord } from '../sources/doc-sync';
import { migrateRollDoc, type RollDoc } from './roll-types';

const DB_NAME = 'atelier-develop';
// Bumped only when an object store is added; a document migration runs on read.
const DB_VERSION = 1;
const ROLLS = 'rolls';
const THUMBS = 'thumbs';
const SYNC = 'sync';
export const PRESETS_STORE = 'presets';

interface ThumbRecord {
  /** The roll picture's id. */
  id: string;
  blob: Blob;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [ROLLS, THUMBS, SYNC, PRESETS_STORE]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function requestAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await requestAsPromise(fn(db.transaction(name, mode).objectStore(name)));
  } finally {
    db.close();
  }
}

// --- rolls ------------------------------------------------------------------

/** All rolls, most recently updated first. `[]` when storage is unusable. */
export async function listRolls(): Promise<RollDoc[]> {
  try {
    const all = await withStore(ROLLS, 'readonly', (s) => s.getAll() as IDBRequest<RollDoc[]>);
    return all.map(migrateRollDoc).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getRoll(id: string): Promise<RollDoc | null> {
  try {
    const doc = await withStore(ROLLS, 'readonly', (s) => s.get(id) as IDBRequest<RollDoc | undefined>);
    return doc ? migrateRollDoc(doc) : null;
  } catch {
    return null;
  }
}

/** Returns false when the write failed (quota, eviction, private window). */
export async function putRoll(doc: RollDoc): Promise<boolean> {
  try {
    await withStore(ROLLS, 'readwrite', (s) => s.put(doc));
    return true;
  } catch {
    return false;
  }
}

export async function deleteRoll(id: string): Promise<void> {
  try {
    await withStore(ROLLS, 'readwrite', (s) => s.delete(id));
  } catch {
    /* already gone or storage unusable */
  }
}

// --- sync records -----------------------------------------------------------

export async function getSyncRecord(id: string): Promise<SyncRecord | null> {
  try {
    return (await withStore(SYNC, 'readonly', (s) => s.get(id) as IDBRequest<SyncRecord | undefined>)) ?? null;
  } catch {
    return null;
  }
}

export async function listSyncRecords(): Promise<SyncRecord[]> {
  try {
    return await withStore(SYNC, 'readonly', (s) => s.getAll() as IDBRequest<SyncRecord[]>);
  } catch {
    return [];
  }
}

export async function putSyncRecord(record: SyncRecord): Promise<boolean> {
  try {
    await withStore(SYNC, 'readwrite', (s) => s.put(record));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSyncRecord(id: string): Promise<void> {
  try {
    await withStore(SYNC, 'readwrite', (s) => s.delete(id));
  } catch {
    /* already gone or storage unusable */
  }
}

// --- picture thumbnails -----------------------------------------------------

/** Save one picture's thumbnail. Silent on failure: a thumbnail is a cache. */
export async function putRollThumb(pictureId: string, blob: Blob, now: number = Date.now()): Promise<void> {
  try {
    const record: ThumbRecord = { id: pictureId, blob, updatedAt: now };
    await withStore(THUMBS, 'readwrite', (s) => s.put(record));
  } catch {
    /* a missing thumbnail costs a cell its picture, never the roll */
  }
}

/** The thumbnails that exist for these pictures, by picture id. */
export async function getRollThumbs(pictureIds: readonly string[]): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  if (pictureIds.length === 0) return out;
  try {
    const db = await openDb();
    try {
      const store = db.transaction(THUMBS, 'readonly').objectStore(THUMBS);
      const records = await Promise.all(
        pictureIds.map((id) => requestAsPromise(store.get(id) as IDBRequest<ThumbRecord | undefined>)),
      );
      for (const r of records) if (r) out.set(r.id, r.blob);
    } finally {
      db.close();
    }
  } catch {
    /* no thumbnails is a valid answer */
  }
  return out;
}

/** Prune: nothing else ever will. Called when pictures leave a roll and when a roll is deleted. */
export async function deleteRollThumbs(pictureIds: readonly string[]): Promise<void> {
  if (pictureIds.length === 0) return;
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(THUMBS, 'readwrite');
      const store = tx.objectStore(THUMBS);
      for (const id of pictureIds) store.delete(id);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      });
    } finally {
      db.close();
    }
  } catch {
    /* storage unusable: nothing to prune */
  }
}
