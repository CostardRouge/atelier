/**
 * Which chapter of each opener's panel is open — remembered per opener, on
 * this device (2026-10-12, question 3 of `docs/opener-inspector-redesign.md`:
 * the panel reopens where the author left it, «‹ All» one tap away).
 *
 * One store for the two places that open a chapter: the picker's index and
 * the numbered pins the stage draws over the opener. Never on a document — a
 * chapter is where the author is looking, not what the piece is.
 */

import { localPref, useLocalPref } from '../../shared/ui/local-pref';

type OpenChapters = Readonly<Record<string, string>>;

const decode = (raw: string | null): OpenChapters => {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
};

const openChapters = localPref<OpenChapters>('atelier.roadtrip.openerChapter', decode, (v) =>
  Object.keys(v).length ? JSON.stringify(v) : null,
);

/** Open one chapter of an opener's panel, or its index (`null`). */
export function openOpenerChapter(variantId: string, chapter: string | null): void {
  const next: Record<string, string> = { ...openChapters.get() };
  if (chapter) next[variantId] = chapter;
  else delete next[variantId];
  openChapters.set(next);
}

/** The open chapter of this opener's panel (null: its index), and the way to change it. */
export function useOpenerChapter(variantId: string): [string | null, (chapter: string | null) => void] {
  const [all] = useLocalPref(openChapters, {});
  return [all[variantId] ?? null, (chapter) => openOpenerChapter(variantId, chapter)];
}
