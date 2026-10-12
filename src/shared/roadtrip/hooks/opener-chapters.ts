/**
 * An opener's settings as numbered CHAPTERS (2026-10-12,
 * `docs/opener-inspector-redesign.md`, his pick of face ★).
 *
 * Virée's panel had grown to 103 controls in nine groups that could not fold,
 * so a reader scrolled a column to find «Ahead». A chapter is one of those
 * groups given a NUMBER that never moves, a one-line summary of what it is set
 * to, a mark when it departs from the defaults, and the words its rows carry
 * for the search. The panel stays the variant's own: a chapter only says
 * which of its groups to show (`Group`'s `chapter`), so no row is redrawn
 * here and no panel is rewritten for it.
 *
 * Pure and DOM-free: what the index draws is computed here and tested beside.
 */

import type { HookContext, HookOptions } from './hook-variant';

/** One fact of a chapter's summary: the option it reads and how it is said. */
export interface ChapterFact {
  key: string;
  /** The words for the value, or null to say nothing (an off switch, a default). */
  say: (value: unknown) => string | null;
}

export interface OpenerChapter {
  /** Stable, and what `Group`'s `chapter` names. */
  id: string;
  title: string;
  /**
   * The options its rows write. What «changed» compares against the
   * variant's defaults and what Reset puts back — the variant's content keys
   * (the stops, the picked pictures) are never among them, so a reset never
   * takes away what the author gave the piece.
   */
  keys: readonly string[];
  /** Its rows' labels and choices, for the search. */
  words: readonly string[];
  /** What it is set to, said in a few words. */
  facts?: readonly ChapterFact[];
  /** Why there is nothing to set here on this piece, or null when there is. */
  unmet?(options: HookOptions, ctx: HookContext): string | null;
}

/** A chapter with its number — its place in the declaration, never re-counted. */
export interface NumberedChapter {
  n: number;
  chapter: OpenerChapter;
}

export function numbered(chapters: readonly OpenerChapter[]): NumberedChapter[] {
  return chapters.map((chapter, i) => ({ n: i + 1, chapter }));
}

/** Two option values are the same setting (arrays and records compared by content). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Whether a chapter departs from the defaults. A key the stored options do
 * not carry reads as its default — an older piece never stored it.
 */
export function chapterChanged(chapter: OpenerChapter, options: HookOptions, defaults: HookOptions): boolean {
  return chapter.keys.some((key) => key in options && !same(options[key], defaults[key]));
}

/** The options with this chapter's keys put back to the defaults. */
export function resetChapter(chapter: OpenerChapter, options: HookOptions, defaults: HookOptions): HookOptions {
  const next: Record<string, unknown> = { ...options };
  for (const key of chapter.keys) {
    if (key in defaults) next[key] = defaults[key];
    else delete next[key];
  }
  return next;
}

/** The chapter's summary line, from the normalised options. */
export function chapterSummary(chapter: OpenerChapter, read: object): string {
  const values = read as Readonly<Record<string, unknown>>;
  return (chapter.facts ?? [])
    .map((fact) => fact.say(values[fact.key]))
    .filter((s): s is string => !!s)
    .join(' · ');
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** What a search for `query` finds: each chapter it touches, with the words that matched. */
export interface ChapterHit {
  n: number;
  chapter: OpenerChapter;
  /** The row words that matched, in their order; empty when only the title did. */
  words: string[];
}

/**
 * The chapters a search names. Accents and case are ignored («vehicule» finds
 * «Vehicle»), every term must match somewhere in the chapter, and a chapter
 * found by its title alone still comes back, with no words.
 */
export function searchChapters(chapters: readonly OpenerChapter[], query: string): ChapterHit[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: ChapterHit[] = [];
  numbered(chapters).forEach(({ n, chapter }) => {
    const title = fold(chapter.title);
    const words = chapter.words.map((w) => ({ w, f: fold(w) }));
    const all = terms.every((t) => title.includes(t) || words.some((x) => x.f.includes(t)));
    if (!all) return;
    hits.push({ n, chapter, words: words.filter((x) => terms.some((t) => x.f.includes(t))).map((x) => x.w) });
  });
  return hits;
}

/** Fact helpers — how a summary says one value. */
export const say = {
  /** A value from a list of words; absent from it, nothing. */
  one:
    (words: Readonly<Record<string, string>>) =>
    (v: unknown): string | null =>
      typeof v === 'string' && v in words ? words[v] : null,
  /** A switch: its word when on, nothing when off. */
  on:
    (word: string) =>
    (v: unknown): string | null =>
      v === true ? word : null,
  /** A number with its unit. */
  num:
    (format: (n: number) => string) =>
    (v: unknown): string | null =>
      typeof v === 'number' && Number.isFinite(v) ? format(v) : null,
};
