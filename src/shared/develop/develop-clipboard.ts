/**
 * The develop CLIPBOARD: one record held for the session, so "the same
 * correction on the next picture" costs two clicks — and crosses Trips ↔
 * Studio with zero storage, because both sheets are the one component and
 * the clipboard is module state, not a document field.
 *
 * Never persisted: a clipboard that outlived the tab would paste yesterday's
 * light onto today's picture without anyone having copied it.
 *
 * Pure and DOM-free; `useSyncExternalStore`-shaped so a button can follow it.
 */

import { cloneDevelop, isDefaultDevelop, withoutBase, type DevelopSettings } from './develop';

let held: DevelopSettings | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** Keep a copy of `settings`; an as-shot develop clears the clipboard. */
export function copyDevelop(settings: DevelopSettings | null): void {
  // The NUMBERS travel, never the material: a base is a fact about one
  // picture's bytes, and its metered gain on a JPEG would be stops too bright.
  const numbers = settings ? withoutBase(settings) : null;
  held = numbers && !isDefaultDevelop(numbers) ? cloneDevelop(numbers) : null;
  notify();
}

/** What was copied, as a fresh object, or null when nothing is held. */
export function pasteDevelop(): DevelopSettings | null {
  return held ? cloneDevelop(held) : null;
}

export function hasCopiedDevelop(): boolean {
  return held !== null;
}

/** For `useSyncExternalStore`: the listener runs on every copy. */
export function subscribeDevelopClipboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: forget what is held. */
export function clearDevelopClipboard(): void {
  held = null;
  notify();
}
