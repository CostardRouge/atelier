import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { cleanName, readPresets, removePreset, savePreset, type AtlasPreset } from './atlas-presets';
import type { AtlasSettings } from './atlas-settings';
import { getValue, setValue } from './atlas-store';

/** Where the presets lived before the atlas store (2026-10-14 → 2026-10-17): moved once, then dropped. */
const LEGACY_KEY = 'atelier.atlas.presets';
const KV_KEY = 'presets';

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p_${Math.random().toString(36).slice(2)}`;
}

function readLegacy(): AtlasPreset[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? readPresets(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

// One book per tab, shared by every component drawing it.
let book: readonly AtlasPreset[] = readLegacy();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: readonly AtlasPreset[]): void {
  book = next;
  for (const l of listeners) l();
}

/**
 * Read the book from the atlas store once per visit. A book still in
 * localStorage is MOVED there — and the old key dropped only once the store
 * said it kept it, so a refused write loses nothing.
 */
function load(): Promise<void> {
  loading ??= (async () => {
    const stored = await getValue<unknown>(KV_KEY);
    if (stored !== null) {
      publish(readPresets(stored));
      return;
    }
    const legacy = readLegacy();
    if (legacy.length && (await setValue(KV_KEY, legacy))) {
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* left behind, harmless: the store is read first */
      }
    }
    publish(legacy);
  })();
  return loading;
}

async function commit(next: AtlasPreset[]): Promise<void> {
  publish(next);
  if (await setValue(KV_KEY, next)) return;
  // No IndexedDB here (a private window): the old key keeps them for the session.
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(next));
  } catch {
    /* held for the visit */
  }
}

/** Every preset kept on this device — for a backup file. */
export async function allPresets(): Promise<readonly AtlasPreset[]> {
  await load();
  return book;
}

/**
 * Presets from a backup file, merged into the book: one of a name already
 * kept is skipped (the book on this device wins), the rest go after it.
 * Answers how many were added.
 */
export async function mergePresets(incoming: readonly AtlasPreset[]): Promise<number> {
  await load();
  let next = [...book];
  let added = 0;
  for (const p of incoming) {
    if (next.some((q) => q.name.toLocaleLowerCase() === p.name.toLocaleLowerCase())) continue;
    next = [...next, { ...p, id: newId() }];
    added += 1;
  }
  if (added) await commit(readPresets(next));
  return added;
}

export interface AtlasPresets {
  list: readonly AtlasPreset[];
  /** Keep the dials under `name` — replacing a preset of that name. False for an empty name. */
  save: (name: string, settings: AtlasSettings) => boolean;
  remove: (id: string) => void;
}

/**
 * The named presets (`atlas-presets.ts`): ONE book for every atlas, kept in
 * the atlas store on this device (his ask, 2026-10-17: «que le maker's logo
 * soit stocké, ainsi que les presets»), written at once since a save is one
 * click, never a drag.
 */
export function useAtlasPresets(): AtlasPresets {
  useEffect(() => {
    void load();
  }, []);
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => book,
    () => book,
  );
  const save = useCallback((name: string, settings: AtlasSettings) => {
    if (!cleanName(name)) return false;
    // After the book is read, or a save made in the first instant would be lost under it.
    void load().then(() => {
      const next = savePreset(book, name, settings, Date.now(), newId);
      if (next) void commit(next);
    });
    return true;
  }, []);
  const remove = useCallback((id: string) => {
    void load().then(() => commit(removePreset(book, id)));
  }, []);
  return { list, save, remove };
}
