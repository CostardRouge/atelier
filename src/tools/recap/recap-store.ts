/**
 * IndexedDB persistence for the Recap instrument — the mosaic store's shape
 * (`mosaic/mosaic-store.ts`): hand-rolled promise wrappers, every entry point
 * degrading rather than throwing, because the browser may deny or evict
 * storage and the tool must keep working in memory when it does.
 *
 * Its own database, `atelier-recap`, six stores created at v1:
 *
 * - `recaps` — the documents (`shared/recap/recap-doc.ts`), read through
 *   `readRecapDoc`;
 * - `prints` — the picture a slot DRAWS, a JPEG of at most `PRINT_EDGE` on its
 *   long side, keyed by the picture's key and shared by every recap of this
 *   device: a Winnow picture is fetched once, a local one is kept once used
 *   (its file is not held after the visit). Pruned to what the recaps still
 *   name when one is deleted;
 * - `clips` — the clips a recap PLAYS (a cell's, the looping background):
 *   Winnow's proxy or the local file itself, same key, same pruning;
 * - `sounds` — each recap's sound file, by recap id;
 * - `thumbs` — one poster per recap, its gallery card;
 * - `sync` — one record per recap kept on an instance;
 * - `kv` — small per-device values (the device names, `aliases`).
 *
 * Said in the legal notice (`LegalNotice.tsx`) and `local-first.md`.
 */

import type { SyncRecord } from '../../shared/sources/doc-sync';
import { styleKey, withStyle } from '../../shared/recap/recap-style';
import { readRecapDoc, type RecapDoc } from '../../shared/recap/recap-doc';

const DB_NAME = 'atelier-recap';
const DB_VERSION = 1;
const RECAPS = 'recaps';
const PRINTS = 'prints';
const CLIPS = 'clips';
const SOUNDS = 'sounds';
const THUMBS = 'thumbs';
const SYNC = 'sync';
const KV = 'kv';
const STORES = [RECAPS, PRINTS, CLIPS, SOUNDS, THUMBS, SYNC, KV];

/** A print's long side: a full 9:16 page is 1920 tall, so a picture drawn across it keeps its grain. */
export const PRINT_EDGE = 2048;

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

async function read<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await openDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(store, 'readonly').objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return undefined;
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

// ---- recaps ----

export async function listRecaps(): Promise<RecapDoc[]> {
  const raw = (await read<unknown[]>(RECAPS, (s) => s.getAll())) ?? [];
  return raw.flatMap((r) => readRecapDoc(r, 'local') ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getRecap(id: string): Promise<RecapDoc | null> {
  const raw = await read<unknown>(RECAPS, (s) => s.get(id));
  return raw ? readRecapDoc(raw, 'local') : null;
}

export function putRecap(doc: RecapDoc): Promise<boolean> {
  return write(RECAPS, (tx) => tx.objectStore(RECAPS).put(doc, doc.id));
}

/** The recap, its poster, sound and sync record — then every print and clip no recap of this device names. */
export async function deleteRecap(doc: RecapDoc): Promise<boolean> {
  const ok = await write([RECAPS, THUMBS, SOUNDS, SYNC], (tx) => {
    tx.objectStore(RECAPS).delete(doc.id);
    tx.objectStore(THUMBS).delete(doc.id);
    tx.objectStore(SOUNDS).delete(doc.id);
    tx.objectStore(SYNC).delete(doc.id);
  });
  if (ok) await pruneMedia();
  return ok;
}

/** Drop the prints and clips no recap of this device names any more. */
export async function pruneMedia(): Promise<void> {
  const keep = new Set<string>();
  for (const r of await listRecaps()) {
    for (const p of r.pictures) keep.add(p.key);
    if (r.background.video) keep.add(r.background.video);
  }
  for (const store of [PRINTS, CLIPS]) {
    const keys = ((await read<IDBValidKey[]>(store, (s) => s.getAllKeys())) ?? []) as string[];
    const gone = keys.filter((k) => typeof k === 'string' && !keep.has(k.replace(/#.*$/, '')));
    if (gone.length) await write(store, (tx) => gone.forEach((k) => tx.objectStore(store).delete(k)));
  }
  // A post's vignette goes with the last recap that remembers sending it.
  const posts = new Set((await listRecaps()).flatMap((r) => r.publish.publications.map((p) => `post:${p.postId}`)));
  const thumbs = ((await read<IDBValidKey[]>(THUMBS, (s) => s.getAllKeys())) ?? []) as string[];
  const stale = thumbs.filter((k) => typeof k === 'string' && k.startsWith('post:') && !posts.has(k));
  if (stale.length) await write(THUMBS, (tx) => stale.forEach((k) => tx.objectStore(THUMBS).delete(k)));
}

// ---- pictures and clips ----

export async function getPrint(key: string): Promise<Blob | null> {
  const v = await read<unknown>(PRINTS, (s) => s.get(key));
  return v instanceof Blob ? v : null;
}

export function putPrint(key: string, blob: Blob): Promise<boolean> {
  return write(PRINTS, (tx) => tx.objectStore(PRINTS).put(blob, key));
}

/** Which of `keys` have a print kept here. */
export async function heldPrints(keys: readonly string[]): Promise<Set<string>> {
  const all = ((await read<IDBValidKey[]>(PRINTS, (s) => s.getAllKeys())) ?? []) as string[];
  const want = new Set(keys);
  return new Set(all.filter((k) => want.has(k)));
}

export async function getClip(key: string): Promise<Blob | null> {
  const v = await read<unknown>(CLIPS, (s) => s.get(key));
  return v instanceof Blob ? v : null;
}

export function putClip(key: string, blob: Blob): Promise<boolean> {
  return write(CLIPS, (tx) => tx.objectStore(CLIPS).put(blob, key));
}

// ---- the sound ----

export interface KeptSound {
  name: string;
  blob: Blob;
}

export async function getSound(recapId: string): Promise<KeptSound | null> {
  const v = await read<unknown>(SOUNDS, (s) => s.get(recapId));
  const r = v as { name?: unknown; blob?: unknown } | undefined;
  return r && typeof r.name === 'string' && r.blob instanceof Blob ? { name: r.name, blob: r.blob } : null;
}

export function putSound(recapId: string, sound: KeptSound | null): Promise<boolean> {
  return write(SOUNDS, (tx) => (sound ? tx.objectStore(SOUNDS).put(sound, recapId) : tx.objectStore(SOUNDS).delete(recapId)));
}

// ---- posters ----

export async function getThumb(id: string): Promise<Blob | null> {
  const v = await read<unknown>(THUMBS, (s) => s.get(id));
  return v instanceof Blob ? v : null;
}

export function putThumb(id: string, blob: Blob): Promise<boolean> {
  return write(THUMBS, (tx) => tx.objectStore(THUMBS).put(blob, id));
}

/** The vignette of what a post sent (lab 15): kept beside the recaps' posters, under `post:<postId>`. */
export const getPostThumb = (postId: string) => getThumb(`post:${postId}`);
export const putPostThumb = (postId: string, blob: Blob) => putThumb(`post:${postId}`, blob);

// ---- sync records ----

export async function getSyncRecord(id: string): Promise<SyncRecord | null> {
  return ((await read<unknown>(SYNC, (s) => s.get(id))) as SyncRecord | undefined) ?? null;
}

export function putSyncRecord(rec: SyncRecord): Promise<boolean> {
  return write(SYNC, (tx) => tx.objectStore(SYNC).put(rec, rec.id));
}

export function deleteSyncRecord(id: string): Promise<boolean> {
  return write(SYNC, (tx) => tx.objectStore(SYNC).delete(id));
}

// ---- small values ----

export async function getValue<T>(key: string): Promise<T | null> {
  return ((await read<unknown>(KV, (s) => s.get(key))) as T | undefined) ?? null;
}

export function setValue(key: string, value: unknown): Promise<boolean> {
  return write(KV, (tx) => tx.objectStore(KV).put(value, key));
}

export function deleteValue(key: string): Promise<boolean> {
  return write(KV, (tx) => tx.objectStore(KV).delete(key));
}

/** A new recap of its template dressed in the style kept on this device, when there is one (`recap-style.ts`). */
export async function styled(doc: RecapDoc): Promise<RecapDoc> {
  return withStyle(doc, await getValue(styleKey(doc.template)).catch(() => null), doc.createdAt);
}

/** How many prints and clips are kept and what they weigh — the gallery's storage line. */
export async function mediaStorage(): Promise<{ prints: number; clips: number; bytes: number }> {
  let bytes = 0;
  const count = async (store: string) => {
    const all = ((await read<unknown[]>(store, (s) => s.getAll())) ?? []) as unknown[];
    for (const v of all) if (v instanceof Blob) bytes += v.size;
    return all.length;
  };
  const prints = await count(PRINTS);
  const clips = await count(CLIPS);
  return { prints, clips, bytes };
}

/** Ask the browser not to clear this site's data on its own; true when it agreed. */
export async function askPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
