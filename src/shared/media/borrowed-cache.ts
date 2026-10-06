/**
 * A session cache of things that must be DISPOSED, not merely let go — an
 * `ImageBitmap`'s pixels are given back on `close()` and never by the
 * collector — held under a byte ceiling with the policy the fetched
 * originals and the decoded RAWs already follow (`held-budget.ts`: least
 * recently used first, the newest never), and BORROWED: a value in
 * someone's hands is never disposed under them. What a borrower holds is
 * counted against the ceiling and never evicted; `clear()` dooms it to be
 * disposed on its last release. Pure but for its map; the ceiling is a
 * function so a spec can squeeze it and a device can set it.
 */

import { toEvict, type HeldEntry } from '../sources/held-budget';

export interface Borrowed<T> {
  value: T;
  /** Hand it back. Idempotent: a second release changes nothing. */
  release: () => void;
}

export interface BorrowedCache<T> {
  /** The value under `key`, borrowed and counted as used now; null where there is none. */
  borrow(key: string): Borrowed<T> | null;
  /**
   * Hold `value` under `key` and borrow it. A value already held under
   * `key` wins — the newcomer is disposed unless it IS that value — so two
   * decodes of one picture never both stay.
   */
  give(key: string, value: T, bytes: number): Borrowed<T>;
  /** Hold `value` under `key` without borrowing it — warmed for whoever asks next. The same rule for a key already held. */
  keep(key: string, value: T, bytes: number): void;
  has(key: string): boolean;
  /** The bytes held, borrowed or not. */
  size(): number;
  keys(): string[];
  /** Dispose what nobody holds; doom what someone does, to its last release. */
  clear(): void;
}

interface Entry<T> {
  value: T;
  bytes: number;
  lastUsed: number;
  borrowed: number;
  doomed: boolean;
}

export function makeBorrowedCache<T>({ ceiling, dispose }: { ceiling: () => number; dispose: (value: T) => void }): BorrowedCache<T> {
  const held = new Map<string, Entry<T>>();
  let tick = 0;
  const drop = (value: T) => {
    try {
      dispose(value);
    } catch {
      /* a bitmap already closed throws nothing worth stopping for */
    }
  };
  const lend = (entry: Entry<T>): Borrowed<T> => {
    entry.borrowed += 1;
    entry.lastUsed = ++tick;
    let out = false;
    return {
      value: entry.value,
      release: () => {
        if (out) return;
        out = true;
        entry.borrowed -= 1;
        if (entry.doomed && entry.borrowed === 0) drop(entry.value);
      },
    };
  };
  /** Let go of the free entries that no longer fit beside what is borrowed. */
  const trim = () => {
    let lent = 0;
    const free: HeldEntry[] = [];
    for (const [key, e] of held) {
      if (e.borrowed > 0) lent += e.bytes;
      else free.push({ key, bytes: e.bytes, lastUsed: e.lastUsed });
    }
    for (const key of toEvict(free, Math.max(0, ceiling() - lent))) {
      const e = held.get(key);
      held.delete(key);
      if (e) drop(e.value);
    }
  };
  const put = (key: string, value: T, bytes: number): Entry<T> => {
    const existing = held.get(key);
    if (existing) {
      if (existing.value !== value) drop(value);
      existing.lastUsed = ++tick;
      return existing;
    }
    const entry: Entry<T> = { value, bytes, lastUsed: ++tick, borrowed: 0, doomed: false };
    held.set(key, entry);
    return entry;
  };
  return {
    borrow(key) {
      const e = held.get(key);
      return e ? lend(e) : null;
    },
    give(key, value, bytes) {
      const borrowed = lend(put(key, value, bytes));
      trim();
      return borrowed;
    },
    keep(key, value, bytes) {
      put(key, value, bytes);
      trim();
    },
    has: (key) => held.has(key),
    size() {
      let n = 0;
      for (const e of held.values()) n += e.bytes;
      return n;
    },
    keys: () => [...held.keys()],
    clear() {
      for (const e of held.values()) {
        if (e.borrowed > 0) e.doomed = true;
        else drop(e.value);
      }
      held.clear();
    },
  };
}
