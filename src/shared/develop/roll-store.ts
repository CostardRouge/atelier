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
 *   `docs/develop-tool.md`), one row;
 * - `folders` (v2) — the directory handles a roll's local pictures came from,
 *   one row per roll (F4 of §9). THIS DEVICE's: never on the document, never
 *   in the roll file, never on the wire — a handle means nothing elsewhere.
 */

import type { SyncRecord } from '../sources/doc-sync';
import type { PersistedDirectoryHandle } from '../sources/file-sources';
import { readPresetBook, type PresetBook } from './preset-book';
import { migrateRollDoc, type RollDoc } from './roll-types';

const DB_NAME = 'atelier-develop';
// Bumped only when an object store is added; a document migration runs on read.
// v2 (2026-09-16): `folders`.
const DB_VERSION = 2;
const ROLLS = 'rolls';
const THUMBS = 'thumbs';
const SYNC = 'sync';
const PRESETS = 'presets';
const FOLDERS = 'folders';

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
      for (const name of [ROLLS, THUMBS, SYNC, PRESETS, FOLDERS]) {
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

// --- the preset book --------------------------------------------------------

/**
 * The person's preset book — ONE row, whatever its id (`preset-book.ts`). The
 * newest one wins should two ever be stored (a move that minted a new id and
 * was interrupted before the old row went).
 */
export async function getPresetBook(): Promise<PresetBook | null> {
  try {
    const all = await withStore(PRESETS, 'readonly', (s) => s.getAll() as IDBRequest<unknown[]>);
    const books = all.flatMap((raw) => readPresetBook(raw) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
    return books[0] ?? null;
  } catch {
    return null;
  }
}

/** Returns false when the write failed; the book lives on in memory. */
export async function putPresetBook(book: PresetBook): Promise<boolean> {
  try {
    await withStore(PRESETS, 'readwrite', (s) => s.put(book));
    return true;
  } catch {
    return false;
  }
}

export async function deletePresetBook(id: string): Promise<void> {
  try {
    await withStore(PRESETS, 'readwrite', (s) => s.delete(id));
  } catch {
    /* already gone or storage unusable */
  }
}

// --- the folders a roll's local pictures came from ---------------------------

/** A remembered folder: what to call it, and the handle one permission click re-reads. */
export interface RollFolder {
  name: string;
  handle: PersistedDirectoryHandle;
}

interface FoldersRecord {
  /** The roll's id. */
  id: string;
  folders: RollFolder[];
}

export async function getRollFolders(rollId: string): Promise<RollFolder[]> {
  try {
    const rec = await withStore(FOLDERS, 'readonly', (s) => s.get(rollId) as IDBRequest<FoldersRecord | undefined>);
    return rec?.folders ?? [];
  } catch {
    return [];
  }
}

/** Returns false when the write failed; the folders then last the session. */
export async function putRollFolders(rollId: string, folders: RollFolder[]): Promise<boolean> {
  try {
    const rec: FoldersRecord = { id: rollId, folders };
    await withStore(FOLDERS, 'readwrite', (s) => s.put(rec));
    return true;
  } catch {
    return false;
  }
}

export async function deleteRollFolders(rollId: string): Promise<void> {
  try {
    await withStore(FOLDERS, 'readwrite', (s) => s.delete(rollId));
  } catch {
    /* already gone or storage unusable */
  }
}

