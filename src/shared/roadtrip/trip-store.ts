/**
 * IndexedDB persistence for road trips — the same shape as
 * `projects/project-store.ts` (hand-rolled, one database, one object store,
 * promise wrappers), deliberately: a trip is ONE document holding its stages
 * and posts, so there is nothing to join and nothing a query engine would buy.
 *
 * Its own database rather than a second store beside the studio's: the two
 * documents have separate versions and separate migrations, and a schema bump
 * on one must not force an upgrade transaction on the other.
 *
 * A second store holds one small JPEG per post — the hook as it was last
 * composed, so opening a day months later SHOWS what is sitting there instead
 * of listing file names. Thumbnails are kept apart from the documents on
 * purpose: they are the only large values here, and a trip document is read on
 * every gallery render while its pictures are wanted only when a day is open.
 *
 * A third store (v3) keeps one SYNC RECORD per trip kept on a connected
 * instance (`trip-sync.ts`): the etag the server last acknowledged and whether
 * the mirror is dirty. Beside the document, never on it — on the document it
 * would leak into the trip file and onto the wire — and durable on purpose:
 * `dirtyAt` surviving a closed tab is what lets the next open push the edit.
 *
 * Every entry point catches storage failures and degrades (empty list / no-op)
 * rather than throwing into the UI — the browser may deny or evict IndexedDB
 * (private windows, disk pressure), and the tool must keep working in memory
 * when it does.
 */

import { migrateTripDoc, type TripDoc } from './trip-types';
import type { SyncRecord } from './trip-sync';

const DB_NAME = 'atelier-roadtrip';
// Bumped only when an object store is added; a document migration runs on
// read and never needs an upgrade transaction.
const DB_VERSION = 3;
const STORE = 'trips';
const THUMBS = 'thumbs';
const SYNC = 'sync';

/** One post's hook, as a small JPEG. Blobs are structured-cloneable. */
interface ThumbRecord {
  id: string;
  blob: Blob;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(THUMBS)) {
        db.createObjectStore(THUMBS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SYNC)) {
        db.createObjectStore(SYNC, { keyPath: 'id' });
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
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
  name: string = STORE,
): Promise<T> {
  const db = await openDb();
  try {
    return await requestAsPromise(fn(db.transaction(name, mode).objectStore(name)));
  } finally {
    db.close();
  }
}

/** All trips, most recently updated first. `[]` when storage is unusable. */
export async function listTrips(): Promise<TripDoc[]> {
  try {
    const all = await withStore('readonly', (s) => s.getAll() as IDBRequest<TripDoc[]>);
    return all.map(migrateTripDoc).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getTrip(id: string): Promise<TripDoc | null> {
  try {
    const doc = await withStore('readonly', (s) => s.get(id) as IDBRequest<TripDoc | undefined>);
    return doc ? migrateTripDoc(doc) : null;
  } catch {
    return null;
  }
}

/** Returns false when the write failed (quota, eviction, private window). */
export async function putTrip(doc: TripDoc): Promise<boolean> {
  try {
    await withStore('readwrite', (s) => s.put(doc));
    return true;
  } catch {
    return false;
  }
}

export async function deleteTrip(id: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id));
  } catch {
    /* already gone or storage unusable — nothing to surface */
  }
}

// --- sync records -----------------------------------------------------------

/** The record for a trip, or null when it has none (a local trip, or storage down). */
export async function getSyncRecord(id: string): Promise<SyncRecord | null> {
  try {
    const rec = await withStore(
      'readonly',
      (s) => s.get(id) as IDBRequest<SyncRecord | undefined>,
      SYNC,
    );
    return rec ?? null;
  } catch {
    return null;
  }
}

/** Every record — the trips this device mirrors from an instance. */
export async function listSyncRecords(): Promise<SyncRecord[]> {
  try {
    return await withStore('readonly', (s) => s.getAll() as IDBRequest<SyncRecord[]>, SYNC);
  } catch {
    return [];
  }
}

/** Returns false when the write failed — the caller keeps the record in memory. */
export async function putSyncRecord(record: SyncRecord): Promise<boolean> {
  try {
    await withStore('readwrite', (s) => s.put(record), SYNC);
    return true;
  } catch {
    return false;
  }
}

export async function deleteSyncRecord(id: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id), SYNC);
  } catch {
    /* already gone or storage unusable */
  }
}

// --- hook thumbnails --------------------------------------------------------

/**
 * Save one post's hook picture. Silent on failure like every other write here:
 * a missing thumbnail costs a row its picture, never the row.
 */
export async function putThumb(id: string, blob: Blob): Promise<void> {
  try {
    const record: ThumbRecord = { id, blob, updatedAt: Date.now() };
    await withStore('readwrite', (s) => s.put(record), THUMBS);
  } catch {
    /* storage unusable — the day panel falls back to text */
  }
}

/** The thumbnails that exist among `ids`, as a map. Missing ids are absent. */
export async function getThumbs(ids: readonly string[]): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  if (!ids.length) return out;
  try {
    const db = await openDb();
    try {
      const store = db.transaction(THUMBS, 'readonly').objectStore(THUMBS);
      const found = await Promise.all(
        ids.map((id) => requestAsPromise(store.get(id) as IDBRequest<ThumbRecord | undefined>)),
      );
      for (const record of found) if (record?.blob) out.set(record.id, record.blob);
    } finally {
      db.close();
    }
  } catch {
    /* nothing stored, or storage unusable */
  }
  return out;
}

/**
 * Forget the thumbnails of posts that are gone. Called when a post or a whole
 * trip is deleted: a thumbnail store nobody prunes grows for the lifetime of
 * the browser profile, and these are the only heavy values in the database.
 */
export async function deleteThumbs(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const db = await openDb();
    try {
      const store = db.transaction(THUMBS, 'readwrite').objectStore(THUMBS);
      await Promise.all(ids.map((id) => requestAsPromise(store.delete(id))));
    } finally {
      db.close();
    }
  } catch {
    /* already gone or storage unusable */
  }
}
