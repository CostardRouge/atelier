/**
 * WHO a cell setting belongs to (lab 17 part I, his yes of 2026-11-10): the
 * first slide — a month's calendar, a dump's cover — in `cells`; the slides
 * after it as a family — the highlights, the weeks, a dump's pictures — in
 * `carousel.cells`; one slide in `carousel.slideCells[key]`. Each says only
 * what it changes and inherits the rest, so an old recap (no family words, no
 * slide words) draws exactly as before.
 *
 * Pure.
 */

import { WORD_KEYS, type CellWords } from './recap-cellwords';
import { withRecap, type RecapCells, type RecapDoc } from './recap-doc';

/** The cell-setting scopes the Layout tab offers. */
export type CellScope = 'first' | 'family' | 'slide';

/** A page of the family — a flow slide (`p:3`) or a week's (`w:1`); never the first, nor a sheet's slice. */
export const inFamily = (pageKey: string) => pageKey.startsWith('p:') || pageKey.startsWith('w:');

/** True when the recap has slides after its first that the family scope speaks for. */
export function hasFamily(doc: RecapDoc): boolean {
  if (doc.template === 'dump') return true;
  if (doc.template === 'sheets' || doc.template === 'wrapped' || doc.template === 'second') return false;
  return doc.carousel.after !== 'none';
}

/** The scopes' names for this template: «Calendar · Highlights», «Cover · Pictures», «Week · Weeks»… */
export function scopeNames(doc: RecapDoc): Record<CellScope, string> {
  const first = doc.template === 'month' ? 'Calendar' : doc.template === 'week' ? 'Week' : doc.template === 'dump' ? 'Cover' : 'First slide';
  const family = doc.template === 'dump' ? 'Pictures' : doc.carousel.after === 'weeks' ? 'Weeks' : 'Highlights';
  return { first, family, slide: 'This slide' };
}

/** What a page's cells say: the first slide's words, then its family's, then its own. */
export function wordsOn(doc: RecapDoc, pageKey: string): RecapCells {
  if (!inFamily(pageKey)) return doc.cells;
  const own = doc.carousel.slideCells[pageKey];
  const fam = doc.carousel.cells;
  if (!own && !Object.keys(fam).length) return doc.cells;
  return { ...doc.cells, ...fam, ...own };
}

/** The family's words, the first slide's under them — what «This slide» shows greyed until it sets its own. */
export const familyWords = (doc: RecapDoc): CellWords => ({ ...pick(doc.cells), ...doc.carousel.cells });

const pick = (c: RecapCells): CellWords => Object.fromEntries(WORD_KEYS.map((k) => [k, c[k]])) as unknown as CellWords;

/** The recap seen from one page: its cells are that page's words — what the painter draws that page with. */
const VIEWS = new WeakMap<RecapDoc, Map<string, RecapDoc>>();
export function docOn(doc: RecapDoc, pageKey: string): RecapDoc {
  const cells = wordsOn(doc, pageKey);
  if (cells === doc.cells) return doc;
  let byKey = VIEWS.get(doc);
  if (!byKey) VIEWS.set(doc, (byKey = new Map()));
  let view = byKey.get(pageKey);
  if (!view) byKey.set(pageKey, (view = { ...doc, cells }));
  return view;
}

/**
 * One word set for a scope: `cells` for the first slide; the family's words
 * (a value equal to the first slide's is still kept — he chose it there);
 * a slide's own (a value equal to its family's is DROPPED — «as the
 * highlights» stays inherited, and the slide's dot goes when nothing is left).
 */
export function withWords(doc: RecapDoc, scope: CellScope, pageKey: string, patch: Partial<CellWords>, now: number = Date.now()): RecapDoc {
  if (scope === 'first') return withRecap(doc, { cells: { ...doc.cells, ...patch } }, now);
  if (scope === 'family') return withRecap(doc, { carousel: { ...doc.carousel, cells: { ...doc.carousel.cells, ...patch } } }, now);
  const fam = familyWords(doc);
  const own: Partial<CellWords> = { ...doc.carousel.slideCells[pageKey], ...patch };
  for (const k of Object.keys(patch) as (keyof CellWords)[]) if (JSON.stringify(own[k]) === JSON.stringify(fam[k])) delete own[k];
  const slideCells = { ...doc.carousel.slideCells };
  if (Object.keys(own).length) slideCells[pageKey] = own;
  else delete slideCells[pageKey];
  return withRecap(doc, { carousel: { ...doc.carousel, slideCells } }, now);
}

/** A slide's own words given back: it says what its family says. */
export function withoutSlideWords(doc: RecapDoc, pageKey: string, key?: keyof CellWords, now: number = Date.now()): RecapDoc {
  const own = { ...doc.carousel.slideCells[pageKey] };
  if (key) delete own[key];
  const slideCells = { ...doc.carousel.slideCells };
  if (key && Object.keys(own).length) slideCells[pageKey] = own;
  else delete slideCells[pageKey];
  return withRecap(doc, { carousel: { ...doc.carousel, slideCells } }, now);
}
