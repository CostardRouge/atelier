/**
 * The VAULT on this device: the packs' indexes and their lattices, in
 * IndexedDB.
 *
 * Its own database, `atelier-lut-packs`, for the reason the trips and the
 * rolls have theirs (`develop/roll-store.ts`): separate things, separate
 * versions, and a schema bump on one must never force an upgrade transaction
 * on another. Two stores:
 *
 * - `packs` — one index per pack (`lut-pack.ts`), the small half: names,
 *   the tree, what is hidden. This is what syncs to a Winnow later (§4 of
 *   `docs/lut-packs.md`).
 * - `lattices` — one encoded lattice per look (`pack-codec.ts`), keyed by the
 *   SHA-256 of the source file, so two packs shipping the same `.cube` store
 *   it once and a re-import recognises what is already here.
 *
 * Hand-rolled promise wrappers, every entry point degrading rather than
 * throwing: a browser may deny or evict storage, and a missing lattice has a
 * defined meaning here — the look says it is not in this vault rather than
 * grading wrongly or disappearing.
 *
 * **Not a cache to fill blindly.** A 65³ look is 1.57 MB; the pack the
 * maintainer bought is 41 MB. That is fine for IndexedDB and deliberate
 * (`docs/lut-packs.md` §4.2), but it is also why the remote copy, once the
 * file store exists, is the authority and this is its mirror.
 */

import { migratePackIndex, type LutPackIndex } from './lut-pack';

const DB_NAME = 'atelier-lut-packs';
const DB_VERSION = 1;
const PACKS = 'packs';
const LATTICES = 'lattices';

/** One look's bytes, as stored. */
export interface LatticeRecord {
  /** SHA-256 of the SOURCE `.cube`, lowercase hex — the key everywhere. */
  id: string;
  /** The pack that brought it in, so removing a pack can clean up after it. */
  packId: string;
  /** `pack-codec.ts` bytes, never `.cube` text. */
  bytes: ArrayBuffer;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [PACKS, LATTICES]) {
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

// --- packs ------------------------------------------------------------------

/** Every pack this browser holds, by name. `[]` when storage is unusable. */
export async function listStoredPacks(): Promise<LutPackIndex[]> {
  try {
    const all = await withStore(PACKS, 'readonly', (s) => s.getAll() as IDBRequest<unknown[]>);
    return all
      .map(migratePackIndex)
      .filter((p): p is LutPackIndex => p !== null)
      .sort((a, b) => (a.name || a.author).localeCompare(b.name || b.author));
  } catch {
    return [];
  }
}

/** Returns false when the write failed (quota, eviction, private window). */
export async function putStoredPack(index: LutPackIndex): Promise<boolean> {
  try {
    await withStore(PACKS, 'readwrite', (s) => s.put(index));
    return true;
  } catch {
    return false;
  }
}

/** Forget a pack AND the lattices it brought in — nothing keeps a look alive alone. */
export async function deleteStoredPack(packId: string): Promise<void> {
  try {
    await withStore(PACKS, 'readwrite', (s) => s.delete(packId));
    const all = await withStore(LATTICES, 'readonly', (s) => s.getAll() as IDBRequest<LatticeRecord[]>);
    const mine = all.filter((r) => r.packId === packId).map((r) => r.id);
    for (const id of mine) await withStore(LATTICES, 'readwrite', (s) => s.delete(id));
  } catch {
    /* already gone or storage unusable */
  }
}

// --- lattices ---------------------------------------------------------------

/** A look's encoded bytes, or null when this device does not hold them. */
export async function getStoredLattice(hash: string): Promise<Uint8Array | null> {
  if (!hash) return null;
  try {
    const row = await withStore(
      LATTICES,
      'readonly',
      (s) => s.get(hash) as IDBRequest<LatticeRecord | undefined>,
    );
    return row ? new Uint8Array(row.bytes) : null;
  } catch {
    return null;
  }
}

/** Returns false when the write failed — the import says so rather than pretending. */
export async function putStoredLattice(
  hash: string,
  packId: string,
  bytes: Uint8Array,
): Promise<boolean> {
  if (!hash) return false;
  try {
    // A copy detached from any larger buffer: what is stored must be exactly
    // the look's bytes, whatever view they arrived in.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const record: LatticeRecord = { id: hash, packId, bytes: copy.buffer, updatedAt: Date.now() };
    await withStore(LATTICES, 'readwrite', (s) => s.put(record));
    return true;
  } catch {
    return false;
  }
}

/** Which of these hashes this device already holds — what a re-import skips. */
export async function storedLatticeHashes(): Promise<Set<string>> {
  try {
    const keys = await withStore(LATTICES, 'readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
    return new Set(keys.map((k) => String(k)));
  } catch {
    return new Set();
  }
}

/** What the vault weighs on this device, in bytes — said before it is emptied. */
export async function storedLatticeBytes(): Promise<number> {
  try {
    const all = await withStore(LATTICES, 'readonly', (s) => s.getAll() as IDBRequest<LatticeRecord[]>);
    return all.reduce((sum, r) => sum + r.bytes.byteLength, 0);
  } catch {
    return 0;
  }
}
