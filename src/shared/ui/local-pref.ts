import { useSyncExternalStore } from 'react';

/**
 * A browser PREFERENCE every reader sees at once (2026-10-06).
 *
 * The suite keeps its per-device choices in `localStorage` — the LUT
 * interpolation, the pixel view, a flag left on — and each hook used to read
 * it into its own `useState`. That held while every choice had one control
 * beside its one reader. Develop's settings page changes them from elsewhere,
 * and a picture open behind the page would keep its old reading until it
 * remounted: a choice that changes nothing on screen reads as broken. So the
 * value lives in the module, once, and every reader subscribes to it — the
 * shape `use-band-preference.ts` already had.
 *
 * Every access is wrapped: a private window, blocked site data or a
 * thumbnail capture can throw on read AND on write, and neither is an error —
 * the choice simply holds for this session.
 */
export interface LocalPref<T> {
  readonly key: string;
  get: () => T;
  set: (next: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function localPref<T>(
  key: string,
  decode: (raw: string | null) => T,
  encode: (value: T) => string | null,
): LocalPref<T> {
  let cached: { value: T } | null = null;
  const listeners = new Set<() => void>();
  const get = (): T => {
    if (!cached) {
      let raw: string | null = null;
      try {
        raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
      } catch {
        raw = null;
      }
      cached = { value: decode(raw) };
    }
    return cached.value;
  };
  const set = (next: T) => {
    cached = { value: next };
    try {
      const raw = encode(next);
      if (raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
    } catch {
      /* the choice still holds for this session */
    }
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return { key, get, set, subscribe };
}

/** The preference as a React value, kept in step with every other reader. */
export function useLocalPref<T>(pref: LocalPref<T>, serverValue: T): [T, (next: T) => void] {
  const value = useSyncExternalStore(pref.subscribe, pref.get, () => serverValue);
  return [value, pref.set];
}
