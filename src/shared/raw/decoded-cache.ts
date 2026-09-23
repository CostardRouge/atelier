/**
 * Decoded RAWs held for the session, so a picture stepped away from and back
 * to is not decoded twice — a decode is seconds and a memory spike, and on a
 * phone the spike is the thing that ends the tab.
 *
 * Keyed by the file's identity AND the size it was asked at (the stage's
 * edge is not the export's), bounded by a byte ceiling the device class
 * sets (`raw-budget.ts`), least recently used let go first and the entry
 * used last never — `held-budget.ts`'s policy, the one the fetched
 * originals already follow. What is held is the decode's own arrays: the
 * half image the GPU takes and, where it was asked for, the as-shot bytes.
 * A consumer that still holds them keeps them; only the cache's reference
 * goes. Session-only, never persisted — media bytes are not
 * (`local-first.md`).
 *
 * Pure but for the module map; the ceiling is an argument so a spec can
 * squeeze it.
 */

import { toEvict, type HeldEntry } from '../sources/held-budget';

export interface DecodedEntry<T> {
  value: T;
  bytes: number;
  lastUsed: number;
}

export interface DecodedCache<T> {
  /** The value held under `key`, counted as used now; null where nothing is. */
  recall(key: string): T | null;
  /** Hold `value` under `key`, then let go of whatever no longer fits. */
  remember(key: string, value: T, bytes: number): void;
  /** Drop everything. */
  clear(): void;
  /** How many bytes are held right now. */
  size(): number;
  keys(): string[];
}

export function makeDecodedCache<T>(ceiling: () => number): DecodedCache<T> {
  const held = new Map<string, DecodedEntry<T>>();
  let tick = 0;
  return {
    recall(key) {
      const entry = held.get(key);
      if (!entry) return null;
      entry.lastUsed = ++tick;
      return entry.value;
    },
    remember(key, value, bytes) {
      held.set(key, { value, bytes, lastUsed: ++tick });
      const entries: HeldEntry[] = [...held].map(([k, e]) => ({ key: k, bytes: e.bytes, lastUsed: e.lastUsed }));
      for (const k of toEvict(entries, ceiling())) held.delete(k);
    },
    clear() {
      held.clear();
    },
    size() {
      let n = 0;
      for (const e of held.values()) n += e.bytes;
      return n;
    },
    keys() {
      return [...held.keys()];
    },
  };
}

/** The identity a file is cached under: its name, its weight and its capture instant. */
export function fileKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
