/**
 * ★ Favourites — the looks worth reaching for first.
 *
 * `docs/lut-packs.md` §6 asks for two things: a Favourites node at the top of
 * the picker's rail, and favourites first in `GradePanel`'s "Add a look"
 * select. This is the list behind both.
 *
 * **Why `localStorage` and not a document.** A favourite is a working
 * preference, like the interpolation mode (`use-lut-interpolation.ts`) and
 * the trip gallery's Cards/Bands choice: it says nothing about what a trip
 * IS, and a `.roadtrip.json` must not carry one person's shortlist into
 * someone else's copy. It is deliberately NOT in the pack index either —
 * a favourite spans built-ins, film stocks and every pack at once, and a
 * shortlist that vanished when a pack was forgotten would be a bug.
 *
 * **Why a module-level store rather than a hook's own state.** The rail and
 * the select are two components that must agree the instant a star is
 * clicked, which is the same reason `pack-vault.ts` holds the packs this way.
 *
 * What is stored is the gallery's own pick id — `<builtin id>`,
 * `film:<stock>`, `pack:<packId>/<lookId>` — so a favourite survives anything
 * that does not change what a look IS. A favourite whose look is gone (a pack
 * forgotten, a `.cube` removed from the build) is simply not drawn; it is
 * left in the list, because forgetting a pack and importing it again should
 * not cost the stars.
 */

import { useSyncExternalStore } from 'react';

const KEY = 'atelier.lut.favourites';
/** A shortlist is a shortlist: past this it is the rail's job, not a star's. */
const MAX = 60;

let favourites: string[] = read();
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((id): id is string => typeof id === 'string' && !!id).slice(0, MAX);
  } catch {
    // Private mode, disabled storage, or junk someone else wrote.
    return [];
  }
}

function write(next: string[]): void {
  favourites = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not persisting is survivable; the session still honours the choice.
  }
  for (const fn of listeners) fn();
}

/** The list as it stands — the same array until it changes, which `useSyncExternalStore` needs. */
export function favouritesSnapshot(): string[] {
  return favourites;
}

export function subscribeFavourites(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isFavourite(id: string): boolean {
  return favourites.includes(id);
}

/**
 * Star or unstar a look. A new favourite goes to the END, so the rail's order
 * is the order they were starred in and nothing jumps under the pointer.
 */
export function toggleFavourite(id: string): void {
  if (!id) return;
  write(
    favourites.includes(id)
      ? favourites.filter((f) => f !== id)
      : [...favourites, id].slice(-MAX),
  );
}

/** Tests, and anything that wants the list emptied. */
export function clearFavourites(): void {
  write([]);
}

/** The starred looks, live. */
export function useLutFavourites(): string[] {
  return useSyncExternalStore(subscribeFavourites, favouritesSnapshot, favouritesSnapshot);
}
