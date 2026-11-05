/**
 * What a recap's slides after the first hold (carousel lab, his yes of
 * 2026-11-05): automatic by default, corrected by hand.
 *
 * - **After the first slide**: nothing, the period's HIGHLIGHTS (the photo
 *   dump's machinery: the best, spread through the days, in its rhythm), or
 *   — for a month — a slide per WEEK. A dump IS highlights.
 * - **Pictures left out** go back to the pool's bench; the rule brings in the
 *   next best, so the count holds.
 * - **One per burst**: frames of the same device within a few seconds, or one
 *   Winnow burst pile, count as one picture — its best, or the one picked.
 * - **A slide's layout** is Auto (the rhythm) unless set; the slides' ORDER
 *   is the author's once moved; the first slide's TITLE may be repeated on
 *   the others.
 *
 * Pure. Types only from `recap-doc.ts`, which reads its defaults from here.
 */

import type { RecapPicture, RecapTemplate } from './recap-doc';

/** A flow slide's arrangement — the photo dump's patterns, plus six. */
export type SlideLayout = 'full' | 'two' | 'oneTwo' | 'three' | 'four' | 'six';
export const SLIDE_LAYOUTS: readonly SlideLayout[] = ['full', 'two', 'oneTwo', 'three', 'four', 'six'];
export const SLIDE_LAYOUT_COUNT: Record<SlideLayout, number> = { full: 1, two: 2, oneTwo: 3, three: 3, four: 4, six: 6 };
export const SLIDE_LAYOUT_LABEL: Record<SlideLayout, string> = { full: '1', two: '2', oneTwo: '1+2', three: '3', four: '4', six: '6' };

export type AfterFirst = 'none' | 'highlights' | 'weeks';
export type SlideTitles = 'first' | 'head' | 'same';

export interface RecapCarousel {
  /** What follows the first slide (a dump's pages are its own highlights). */
  after: AfterFirst;
  /** How many highlights follow, when `after` is `highlights`. */
  highlights: number;
  /** One picture per burst. */
  bursts: boolean;
  /** Pictures left out of the highlights (and a dump), by key — the bench. */
  left: string[];
  /** A burst's frame picked by hand, by burst id. */
  burstPick: Record<string, string>;
  /** A flow slide's layout set by hand, by slide key (`p:3`). */
  layouts: Record<string, SlideLayout>;
  /** The slides' order once moved, by key (`first`, `p:0`, `w:1`, `clip:<slot>`); null = their own. */
  order: string[] | null;
  /** The first slide's title on the others: not at all, as a running head, or as on the first. */
  titles: SlideTitles;
}

export const MAX_HIGHLIGHTS = 60;

export function defaultCarousel(template: RecapTemplate): RecapCarousel {
  return { after: template === 'month' ? 'highlights' : 'none', highlights: 8, bursts: true, left: [], burstPick: {}, layouts: {}, order: null, titles: 'first' };
}

const strings = (v: unknown, max: number): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 400))].slice(0, max) : []);

export function readCarousel(raw: unknown, template: RecapTemplate): RecapCarousel {
  const base = defaultCarousel(template);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const after = r.after === 'none' || r.after === 'highlights' || (r.after === 'weeks' && template === 'month') ? r.after : base.after;
  const n = typeof r.highlights === 'number' && Number.isFinite(r.highlights) ? Math.round(r.highlights) : base.highlights;
  const record = <T extends string>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> => {
    const out: Record<string, T> = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 400)) if (k.length <= 400 && ok(x)) out[k] = x;
    return out;
  };
  return {
    after,
    highlights: Math.min(MAX_HIGHLIGHTS, Math.max(1, n)),
    bursts: typeof r.bursts === 'boolean' ? r.bursts : base.bursts,
    left: strings(r.left, 4000),
    burstPick: record(r.burstPick, (x): x is string => typeof x === 'string' && x.length <= 400),
    layouts: record(r.layouts, (x): x is SlideLayout => SLIDE_LAYOUTS.includes(x as SlideLayout)),
    order: Array.isArray(r.order) ? strings(r.order, 200) : null,
    titles: r.titles === 'head' || r.titles === 'same' ? r.titles : 'first',
  };
}

// ---- bursts -------------------------------------------------------------------------

/** Frames this close, on one device, are one burst. */
export const BURST_SECONDS = 3;

/**
 * The bursts among `list`, as a map from a picture's key to its burst's id
 * (pictures alone are absent). A burst is a Winnow burst pile, or a chain of
 * frames of one device each at most `BURST_SECONDS` after the last — read
 * only where both capture instants carry their seconds (a minute alone
 * would make every minute a burst).
 */
export function burstsOf(list: readonly RecapPicture[]): Map<string, string> {
  const out = new Map<string, string>();
  const piles = new Map<string, RecapPicture[]>();
  for (const p of list) {
    if (p.burst !== undefined) {
      const id = `b:${p.instance ?? ''}:${p.burst}`;
      const pile = piles.get(id);
      if (pile) pile.push(p);
      else piles.set(id, [p]);
    }
  }
  for (const [id, pile] of piles) if (pile.length > 1) for (const p of pile) out.set(p.key, id);
  const timed = list
    .filter((p) => !out.has(p.key) && p.kind === 'photo' && p.day !== null && p.second !== undefined)
    .sort((a, b) => (a.device ?? '').localeCompare(b.device ?? '') || a.day!.localeCompare(b.day!) || a.second! - b.second!);
  let run: RecapPicture[] = [];
  const close = () => {
    if (run.length > 1) for (const p of run) out.set(p.key, `t:${run[0].key}`);
    run = [];
  };
  for (const p of timed) {
    const last = run[run.length - 1];
    if (last && last.device === p.device && last.day === p.day && p.second! - last.second! <= BURST_SECONDS) run.push(p);
    else {
      close();
      run = [p];
    }
  }
  close();
  return out;
}

/** The frames of each burst, by its id. */
export function burstMembers(list: readonly RecapPicture[], bursts: ReadonlyMap<string, string>): Map<string, RecapPicture[]> {
  const out = new Map<string, RecapPicture[]>();
  for (const p of list) {
    const id = bursts.get(p.key);
    if (!id) continue;
    const m = out.get(id);
    if (m) m.push(p);
    else out.set(id, [p]);
  }
  return out;
}

/**
 * The pool the highlights (or a dump) draw from: the pictures in scope, the
 * ones left out removed, and — one per burst — each burst reduced to the
 * frame picked by hand, else the best by `rank`.
 */
export function carouselPool(list: readonly RecapPicture[], c: Pick<RecapCarousel, 'left' | 'bursts' | 'burstPick'>, rank: (l: readonly RecapPicture[]) => RecapPicture[]): RecapPicture[] {
  const left = new Set(c.left);
  const kept = list.filter((p) => !left.has(p.key));
  if (!c.bursts) return kept;
  const bursts = burstsOf(kept);
  const leads = new Set<string>();
  for (const [id, members] of burstMembers(kept, bursts)) {
    const picked = members.find((m) => m.key === c.burstPick[id]);
    leads.add((picked ?? rank(members)[0]).key);
  }
  return kept.filter((p) => !bursts.has(p.key) || leads.has(p.key));
}
