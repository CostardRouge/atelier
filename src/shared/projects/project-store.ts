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
 *
 * A second store (v2) keeps one SYNC RECORD per project kept on a connected
 * instance (`sources/doc-sync.ts`): the etag the server last acknowledged and
 * whether the mirror is dirty — beside the document, never on it, and
 * durable, the same shape as the road-trip store's.
 */

import { migrateProjectDoc, type ProjectDoc } from './project-types';
import type { SyncRecord } from '../sources/doc-sync';

const DB_NAME = 'atelier-studio';
// Bumped only when an object store is added; a document migration runs on
// read and never needs an upgrade transaction.
const DB_VERSION = 2;
const STORE = 'projects';
const SYNC = 'sync';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
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

// --- sync records -----------------------------------------------------------

/** The record for a project, or null when it has none (a local project, or storage down). */
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
