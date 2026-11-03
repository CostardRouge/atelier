import { versionOf, withVersion, type ScriptVersion, type VersionWhy } from '../../shared/story/script-versions';
import type { StoryScript } from '../../shared/story/story-script';

/**
 * Where the script's versions are kept (`script-versions.ts`): IndexedDB on
 * this device, its own database — ten copies of a script holding a wall's
 * pool would crowd `localStorage`, where the script itself must fit. One
 * record, the list, written one keep after the other so two writes never
 * race. A storage that refuses keeps nothing and says nothing: the versions
 * are a safety net, never the work. Forget clears them with the script.
 */
const DB_NAME = 'atelier-story-versions';
const STORE = 'versions';
const KEY = 'list';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

let cache: ScriptVersion[] | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((fn) => fn());

export function subscribeVersions(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The kept versions, newest first (empty while unread or unusable). */
export const versionsNow = (): ScriptVersion[] => cache ?? EMPTY;
const EMPTY: ScriptVersion[] = [];

async function read(): Promise<ScriptVersion[]> {
  if (cache) return cache;
  try {
    const got = await run<ScriptVersion[] | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<ScriptVersion[] | undefined>);
    cache = Array.isArray(got) ? got : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Read the list once, for the panel that shows it. */
export function loadVersions(): void {
  if (cache) return;
  void read().then(tell);
}

let chain: Promise<void> = Promise.resolve();

/** Keep a version of `script` — `json` when the caller has serialised it already. */
export function keepVersion(script: StoryScript, why: VersionWhy, json?: string): Promise<void> {
  const v = versionOf(script, Date.now(), why, json);
  chain = chain.then(async () => {
    const next = withVersion(await read(), v);
    if (!next) return;
    cache = next;
    tell();
    try {
      await run('readwrite', (s) => s.put(next, KEY));
    } catch {
      // Unusable storage: the list lives in this tab only.
    }
  });
  return chain;
}

/** Every version gone — the script's Forget. */
export function clearVersions(): Promise<void> {
  chain = chain.then(async () => {
    cache = [];
    tell();
    try {
      await run('readwrite', (s) => s.delete(KEY));
    } catch {
      // Nothing kept to clear.
    }
  });
  return chain;
}
