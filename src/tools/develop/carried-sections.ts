/**
 * Which sections a paste CARRIES — one standing choice of this browser, read
 * by ⌘V, edited from the paste glyph's ▾ and from the ⚙ sheet's ticks alike,
 * so the two can never disagree. A convenience like a remembered tab, never on
 * the roll: it is how this person pastes, not a fact about the pictures.
 *
 * `useSyncExternalStore`-shaped so the menu and the sheet follow each other.
 */

import { useSyncExternalStore } from 'react';
import { DEFAULT_COPY_SECTIONS, readSections, type PictureSection } from '../../shared/develop/picture-sections';

const STORE_KEY = 'atelier.develop.sections';

function readStored(): PictureSection[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return readSections(raw ? JSON.parse(raw) : null);
  } catch {
    return [...DEFAULT_COPY_SECTIONS];
  }
}

let current: PictureSection[] | null = null;
const listeners = new Set<() => void>();

export function carriedSections(): PictureSection[] {
  if (!current) current = readStored();
  return current;
}

export function setCarriedSections(next: readonly PictureSection[]): void {
  current = readSections(next);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(current));
  } catch {
    /* a private window: the choice lasts this tab */
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCarriedSections(): PictureSection[] {
  return useSyncExternalStore(subscribe, carriedSections);
}
