/**
 * The band preference as a React value — whether a big frame is drawn in
 * bands on this device (`band-policy.ts`), read by the row under the Look
 * panel's Interpolation and by the loupe, which repaints when it moves.
 *
 * The value lives in the graph module (`getBandPreference`), because every
 * grader built later — an export's, the loupe's — reads it there at render
 * time; this hook only keeps React in step with it and persists the choice.
 * `useSyncExternalStore` rather than a `useState` per caller, so the switch in
 * one panel reaches the loupe in another component at once: a choice that
 * changed nothing on screen reads as broken.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { BAND_PREFERENCE_KEY, type BandPreference } from './band-policy';
import { getBandPreference, setBandPreference } from './graph';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot = (): BandPreference => 'auto';

export interface BandPreferencePref {
  preference: BandPreference;
  setPreference: (next: BandPreference) => void;
}

export function useBandPreference(): BandPreferencePref {
  const preference = useSyncExternalStore(subscribe, getBandPreference, serverSnapshot);
  const setPreference = useCallback((next: BandPreference) => {
    setBandPreference(next);
    try {
      localStorage.setItem(BAND_PREFERENCE_KEY, next);
    } catch {
      // Private mode, disabled storage — the session still honours the choice.
    }
    for (const listener of listeners) listener();
  }, []);
  return { preference, setPreference };
}
