/**
 * IndexedDB persistence for studio projects — the app's first durable store
 * beyond `localStorage` UI prefs. Hand-rolled (no dependency): one database,
 * one object store, promise wrappers around the IDB request dance.
 *
 * Directory handles and thumbnail blobs are structured-cloneable, so whole
 * `ProjectDoc`s go in and out untouched. Every entry point catches storage
 * failures and degrades (empty list / no-op) rather than throwing into the
 * UI — the browser may deny or evict IndexedDB (private windows, disk
 * pressure), and the studio must keep editing in memory when it does.
 */

import { migrateProjectDoc, type ProjectDoc } from './project-types';

const DB_NAME = 'atelier-studio';
const DB_VERSION = 1;
const STORE = 'projects';

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

/** All projects, most recently updated first. `[]` when storage is unusable. */
export async function listProjects(): Promise<ProjectDoc[]> {
  try {
    const all = await withStore('readonly', (s) => s.getAll() as IDBRequest<ProjectDoc[]>);
    return all.map(migrateProjectDoc).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getProject(id: string): Promise<ProjectDoc | null> {
  try {
    const doc = await withStore('readonly', (s) => s.get(id) as IDBRequest<ProjectDoc | undefined>);
    return doc ? migrateProjectDoc(doc) : null;
  } catch {
    return null;
  }
}

/** Returns false when the write failed (quota, eviction, private window). */
export async function putProject(doc: ProjectDoc): Promise<boolean> {
  try {
    await withStore('readwrite', (s) => s.put(doc));
    return true;
  } catch {
    return false;
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id));
  } catch {
    /* already gone or storage unusable — nothing to surface */
  }
}

/**
 * Ask the browser not to evict our storage under disk pressure. Best-effort:
 * some browsers grant silently, some ignore. The grant is ORIGIN-wide, not
 * per database, so one call covers every store the suite keeps — the studio
 * and Road Trip each ask once on mount, and whichever runs first serves both.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
