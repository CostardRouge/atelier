import { localPref, useLocalPref, type LocalPref } from './local-pref';

/**
 * A boolean the BROWSER remembers — a panel left open, an overlay left on.
 *
 * Not a document: it is how this machine is being looked at, and it must never
 * travel in a roll, a trip or a project. The rule the repo already follows for
 * the LUT interpolation mode and the gallery's card/band choice; this is the
 * shape of it, so the next one costs a line instead of another module.
 *
 * One value per key for every reader (`local-pref.ts`): a flag set in Develop's
 * settings page reaches the picture open behind it at once. Every access is
 * wrapped there — a private window or blocked site data is not an error, the
 * flag simply holds for this session.
 */
const flags = new Map<string, LocalPref<boolean>>();

/** The shared preference behind a key; the first caller's fallback is the key's. */
export function localFlag(key: string, fallback = false): LocalPref<boolean> {
  let pref = flags.get(key);
  if (!pref) {
    pref = localPref<boolean>(key, (raw) => (raw === null ? fallback : raw === '1'), (on) => (on ? '1' : '0'));
    flags.set(key, pref);
  }
  return pref;
}

export function useLocalFlag(key: string, fallback = false): [boolean, (next: boolean) => void] {
  return useLocalPref(localFlag(key, fallback), fallback);
}
