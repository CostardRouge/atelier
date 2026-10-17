/**
 * IndexedDB persistence for the Flight Atlas — the trip and roll stores'
 * shape (`develop/roll-store.ts`): hand-rolled, promise wrappers, every entry
 * point degrading rather than throwing, because the browser may deny or evict
 * storage and the tool must keep working in memory when it does.
 *
 * Its own database, `atelier-atlas`, so a schema bump here never forces an
 * upgrade on another tool's. Five stores, all created at v1:
 *
 * - `atlases` — the documents (`atlas-doc.ts`), read through `readAtlasDoc`;
 * - `logs` — each flight log's TEXT once, keyed by its SHA-256 and shared by
 *   every atlas drawing it: what reopens an atlas with no Library and no
 *   instance. Pruned when the last atlas drawing a log is deleted;
 * - `thumbs` — one poster per atlas, the gallery card's cover, this device's;
 * - `sync` — one record per atlas kept on an instance (`sources/doc-sync.ts`),
 *   beside the document and never on it — created now so keeping an atlas on
 *   a Winnow adds no upgrade;
 * - `kv` — the preset book and the one-time «first atlas» mark.
 *
 * The makers' logos keep their own database (`atlas-logos.ts`, kept since
 * before atlases existed).
 */

import type { SyncRecord } from '../../shared/sources/doc-sync';
import { readAtlasDoc, type AtlasDoc } from './atlas-doc';

const DB_NAME = 'atelier-atlas';
const DB_VERSION = 1;
const ATLASES = 'atlases';
const LOGS = 'logs';
const THUMBS = 'thumbs';
const SYNC = 'sync';
const KV = 'kv';

interface LogRecord {
  hash: string;
  text: string;
  size: number;
  addedAt: number;
}

interface ThumbRecord {
  id: string;
  blob: Blob;
  updatedAt: number;
}

interface KvRecord {
  key: string;
  value: unknown;
}

/** A log younger than this is never pruned: the atlas that just took it may not be saved yet. */
const PRUNE_GRACE_MS = 10 * 60 * 1000;

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ATLASES)) db.createObjectStore(ATLASES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(LOGS)) db.createObjectStore(LOGS, { keyPath: 'hash' });
      if (!db.objectStoreNames.contains(THUMBS)) db.createObjectStore(THUMBS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SYNC)) db.createObjectStore(SYNC, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading later: let it, and open afresh next time.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  }).catch((err: unknown) => {
    opening = null;
    throw err;
  });
  return opening;
}

/** One request's answer, or `fallback` when anything refuses. */
async function read<T>(store: string, ask: (s: IDBObjectStore) => IDBRequest, fallback: T): Promise<T> {
  try {
    const db = await openDb();
    return await new Promise<T>((resolve) => {
      const req = ask(db.transaction(store, 'readonly').objectStore(store));
      req.onsuccess = () => resolve((req.result as T | undefined) ?? fallback);
      req.onerror = () => resolve(fallback);
    });
  } catch {
    return fallback;
  }
}

/** A write transaction over `stores`; true once it committed. */
async function write(stores: string | string[], fn: (tx: IDBTransaction) => void): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(stores, 'readwrite');
      fn(tx);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  }
}

// --- atlases -----------------------------------------------------------------

/** Every atlas on this device, newest first. */
export async function listAtlases(): Promise<AtlasDoc[]> {
  const raw = await read<unknown[]>(ATLASES, (s) => s.getAll(), []);
  return raw
    .flatMap((r) => readAtlasDoc(r, 'local') ?? [])
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAtlas(id: string): Promise<AtlasDoc | null> {
  const raw = await read<unknown>(ATLASES, (s) => s.get(id), null);
  return raw ? readAtlasDoc(raw, 'local') : null;
}

/** False when the browser refused it — said on screen, never swallowed. */
export function putAtlas(doc: AtlasDoc): Promise<boolean> {
  return write(ATLASES, (tx) => tx.objectStore(ATLASES).put(doc));
}

/** The atlas, its poster and its sync record — then every log no atlas draws any more. */
export async function deleteAtlas(doc: AtlasDoc): Promise<boolean> {
  const ok = await write([ATLASES, THUMBS, SYNC], (tx) => {
    tx.objectStore(ATLASES).delete(doc.id);
    tx.objectStore(THUMBS).delete(doc.id);
    tx.objectStore(SYNC).delete(doc.id);
  });
  if (ok) await pruneLogs();
  return ok;
}

// --- logs --------------------------------------------------------------------

/** Keep each log's text under its hash (a hash already kept is left as it is). */
export async function putLogs(logs: ReadonlyMap<string, string>, now: number = Date.now()): Promise<boolean> {
  if (!logs.size) return true;
  const have = await logHashes();
  return write(LOGS, (tx) => {
    const store = tx.objectStore(LOGS);
    for (const [hash, text] of logs) {
      if (have.has(hash)) continue;
      const rec: LogRecord = { hash, text, size: text.length, addedAt: now };
      store.put(rec);
    }
  });
}

/** The texts of `hashes` this device keeps; a missing one is simply absent. */
export async function getLogs(hashes: Iterable<string>): Promise<Map<string, string>> {
  const wanted = [...new Set(hashes)];
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const store = db.transaction(LOGS, 'readonly').objectStore(LOGS);
      let left = wanted.length;
      for (const hash of wanted) {
        const req = store.get(hash);
        req.onsuccess = () => {
          const rec = req.result as LogRecord | undefined;
          if (rec && typeof rec.text === 'string') out.set(hash, rec.text);
          if (--left === 0) resolve();
        };
        req.onerror = () => {
          if (--left === 0) resolve();
        };
      }
    });
  } catch {
    /* none kept: the editor says which logs are missing */
  }
  return out;
}

/** Every hash whose text is kept here. */
export async function logHashes(): Promise<Set<string>> {
  const keys = await read<IDBValidKey[]>(LOGS, (s) => s.getAllKeys(), []);
  return new Set(keys.filter((k): k is string => typeof k === 'string'));
}

/**
 * Drop the logs no atlas draws any more. A log taken in the last few minutes
 * is spared: the open atlas may hold it before its debounced save lands.
 */
export async function pruneLogs(now: number = Date.now()): Promise<number> {
  const keep = new Set((await listAtlases()).flatMap((a) => a.flights.map((f) => f.log)));
  const recs = await read<LogRecord[]>(LOGS, (s) => s.getAll(), []);
  const gone = recs.filter((r) => !keep.has(r.hash) && now - (r.addedAt ?? 0) > PRUNE_GRACE_MS).map((r) => r.hash);
  if (!gone.length) return 0;
  const ok = await write(LOGS, (tx) => {
    for (const hash of gone) tx.objectStore(LOGS).delete(hash);
  });
  return ok ? gone.length : 0;
}

// --- posters -----------------------------------------------------------------

export async function getThumb(id: string): Promise<Blob | null> {
  const rec = await read<ThumbRecord | null>(THUMBS, (s) => s.get(id), null);
  return rec?.blob ?? null;
}

export function putThumb(id: string, blob: Blob, now: number = Date.now()): Promise<boolean> {
  const rec: ThumbRecord = { id, blob, updatedAt: now };
  return write(THUMBS, (tx) => tx.objectStore(THUMBS).put(rec));
}

/** A clone's cover is its original's until it is drawn again. */
export async function copyThumb(from: string, to: string): Promise<void> {
  const blob = await getThumb(from);
  if (blob) await putThumb(to, blob);
}

// --- sync records ------------------------------------------------------------

export function getSyncRecord(id: string): Promise<SyncRecord | null> {
  return read<SyncRecord | null>(SYNC, (s) => s.get(id), null);
}

export function putSyncRecord(rec: SyncRecord): Promise<boolean> {
  return write(SYNC, (tx) => tx.objectStore(SYNC).put(rec));
}

export function deleteSyncRecord(id: string): Promise<boolean> {
  return write(SYNC, (tx) => tx.objectStore(SYNC).delete(id));
}

// --- small values ------------------------------------------------------------

export async function getValue<T>(key: string): Promise<T | null> {
  const rec = await read<KvRecord | null>(KV, (s) => s.get(key), null);
  return rec ? (rec.value as T) : null;
}

export function setValue(key: string, value: unknown): Promise<boolean> {
  const rec: KvRecord = { key, value };
  return write(KV, (tx) => tx.objectStore(KV).put(rec));
}

// --- the device's storage ------------------------------------------------------

export interface StorageState {
  /** Bytes this site uses, all its databases together; null where the browser does not say. */
  usage: number | null;
  /** What the browser would let it use; null where it does not say. */
  quota: number | null;
  /** The browser promised not to clear it on its own. */
  persisted: boolean;
  /** The browser can be asked for that promise at all. */
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
