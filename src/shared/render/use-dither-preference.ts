/**
 * The dither preference as a React value — whether this device dithers the
 * canvas's last rounding (`dither.ts`), set in Develop's settings page.
 *
 * The value lives in the graph module (`getDitherPreference`), read by every
 * grader at render time; this hook keeps React in step with it and persists
 * the choice — the shape of `use-band-preference.ts`.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { DITHER_PREFERENCE_KEY, type DitherPreference } from './dither';
import { getDitherPreference, setDitherPreference } from './graph';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface DitherPreferencePref {
  preference: DitherPreference;
  setPreference: (next: DitherPreference) => void;
}

export function useDitherPreference(): DitherPreferencePref {
  const preference = useSyncExternalStore(subscribe, getDitherPreference, () => 'auto' as const);
  const setPreference = useCallback((next: DitherPreference) => {
    setDitherPreference(next);
    try {
      localStorage.setItem(DITHER_PREFERENCE_KEY, next);
    } catch {
      // Private mode, disabled storage — the session still honours the choice.
    }
    for (const listener of listeners) listener();
  }, []);
  return { preference, setPreference };
}
