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
 * Every entry point catches storage failures and degrades (empty list / no-op)
 * rather than throwing into the UI — the browser may deny or evict IndexedDB
 * (private windows, disk pressure), and the tool must keep working in memory
 * when it does.
 */

import { migrateTripDoc, type TripDoc } from './trip-types';

const DB_NAME = 'atelier-roadtrip';
const DB_VERSION = 1;
const STORE = 'trips';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
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
): Promise<T> {
  const db = await openDb();
  try {
    return await requestAsPromise(fn(db.transaction(STORE, mode).objectStore(STORE)));
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
