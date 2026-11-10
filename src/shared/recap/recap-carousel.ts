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
import { readWords, type CellWords } from './recap-cellwords';
import { looksAlike, leaves, phashOf, rankBy, readPictureRules, type PictureFacts, type PictureRules } from '../sources/winnow/picture-rules';

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
  /** What the rule leaves out and prefers — the conditions shared with Storytelling's wall (`picture-rules.ts`). */
  rules: PictureRules;
  /** Draw from Winnow's picks only; null = on by itself when the picks fill the places (removal lab, his yes). */
  /** Picks only (true), every kept picture (false), the ♥ only (`'favs'`, Winnow #355), or null: by itself — the ♥ when they fill the places, else the picks when they do, else everything. */
  picksOnly: boolean | null | 'favs';
  /**
   * The selection FROZEN by his first correction (✕, ⇄, a pin, ↺), by key, in
   * time order: the rule no longer reshuffles it until «Let the rule choose
   * again» (null). A removed picture is gone, never refilled.
   */
  chosen: string[] | null;
  /** Pictures removed from the carousel, by key — the bench, each back with ↺. */
  left: string[];
  /** A burst's frame picked by hand, by burst id. */
  burstPick: Record<string, string>;
  /** A flow slide's layout set by hand, by slide key (`p:3`). */
  layouts: Record<string, SlideLayout>;
  /** The slides' order once moved, by key (`first`, `p:0`, `w:1`, `clip:<slot>`); null = their own. */
  order: string[] | null;
  /** The first slide's title on the others: not at all, as a running head, or as on the first. */
  titles: SlideTitles;
  /**
   * What the slides after the first SAY (lab 17 part I): the highlights' or
   * the weeks' own cell words over the first slide's (`cells`) — what they do
   * not set, they inherit (`recap-scope.ts`).
   */
  cells: Partial<CellWords>;
  /** One slide's own words over its family's, by page key (`p:3`, `w:1`) — kept like `layouts`. */
  slideCells: Record<string, Partial<CellWords>>;
  /** The running head also says the slide's days in the highlights' format («NOVEMBER · 3 – 8 NOV · 2/4»). */
  headDates: boolean;
}

export const MAX_HIGHLIGHTS = 60;

export function defaultCarousel(template: RecapTemplate): RecapCarousel {
  // A NEW month's highlights say their date «10 Nov» (Q1); a recap made before keeps what it printed (`readCarousel`).
  const cells: Partial<CellWords> = template === 'month' ? { date: 'dMon' } : {};
  return { after: template === 'month' ? 'highlights' : 'none', highlights: 8, rules: readPictureRules(null), picksOnly: null, chosen: null, left: [], burstPick: {}, layouts: {}, order: null, titles: 'first', cells, slideCells: {}, headDates: false };
}

const strings = (v: unknown, max: number): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 400))].slice(0, max) : []);

export function readCarousel(raw: unknown, template: RecapTemplate): RecapCarousel {
  // A document without these words was made before them: its slides say what they always did (Q2), never the new default.
  const base = { ...defaultCarousel(template), cells: {} };
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
    // `bursts: false` was the burst switch's first form, the morning it was made.
    rules: (() => {
      const rules = readPictureRules(r.rules);
      if (r.bursts === false && !r.rules) rules.leave.burst = false;
      return rules;
    })(),
    picksOnly: typeof r.picksOnly === 'boolean' || r.picksOnly === 'favs' ? r.picksOnly : null,
    chosen: Array.isArray(r.chosen) ? strings(r.chosen, 400) : null,
    left: strings(r.left, 4000),
    burstPick: record(r.burstPick, (x): x is string => typeof x === 'string' && x.length <= 400),
    layouts: record(r.layouts, (x): x is SlideLayout => SLIDE_LAYOUTS.includes(x as SlideLayout)),
    order: Array.isArray(r.order) ? strings(r.order, 200) : null,
    titles: r.titles === 'head' || r.titles === 'same' ? r.titles : 'first',
    cells: r.cells !== undefined ? readWords(r.cells) : base.cells,
    slideCells: (() => {
      const out: Record<string, Partial<CellWords>> = {};
      if (r.slideCells && typeof r.slideCells === 'object' && !Array.isArray(r.slideCells))
        for (const [k, v] of Object.entries(r.slideCells as Record<string, unknown>).slice(0, 200)) {
          const w = readWords(v);
          if (k.length <= 40 && Object.keys(w).length) out[k] = w;
        }
      return out;
    })(),
    headDates: r.headDates === true,
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

/** A picture as the shared conditions read it. A local picture is a «screen» only as a PNG: a file may carry no EXIF and still be a photograph. */
export function factsOf(p: RecapPicture): PictureFacts & { key: string } {
  const day = p.day ? Date.parse(`${p.day}T00:00:00Z`) / 1000 : 0;
  return {
    key: p.key,
    fav: Boolean(p.fav),
    pick: Boolean(p.picked),
    reject: false,
    stars: p.stars ?? 0,
    edited: Boolean(p.edited),
    faces: p.faces ?? 0,
    sharp: p.sharp ?? null,
    burst: p.burst ?? null,
    screen: /\.png$/i.test(p.name) || (p.origin === 'winnow' && !p.device),
    phash: phashOf(p.phash),
    folder: p.folder ?? null,
    at: day + (p.second ?? (p.minute ?? 720) * 60),
  };
}

/** `list` best first by the carousel's preferences — then its time. */
export function rankByRules(prefer: PictureRules['prefer']): (list: readonly RecapPicture[]) => RecapPicture[] {
  const order = rankBy<PictureFacts & { key: string }>(prefer);
  return (list) => {
    const facts = new Map(list.map((p) => [p.key, factsOf(p)]));
    return [...list].sort((a, b) => order(facts.get(a.key)!, facts.get(b.key)!));
  };
}

export interface PoolReport {
  pool: RecapPicture[];
  /** How many each condition took out, for the panel. */
  left: { screen: number; burst: number; alike: number };
  /** Whether the rule draws from the picks only (set, or by itself). */
  picksOnly: boolean;
  /** Whether it draws from the ♥ only (set, or by itself). */
  favsOnly: boolean;
  /** What it draws from, resolved — what a pool asked again with the same choice passes. */
  drawFrom: boolean | 'favs';
  picks: number;
  favs: number;
}

/**
 * The pool the highlights (a dump, a sheet) draw from: the pictures in
 * scope, the removed ones out, then the shared conditions — screenshots, all
 * but one frame of a burst (the one picked by hand, else the best), the
 * look-alikes of a better picture — and, when `picksOnly` says so (or, unset,
 * when the picks fill the `places`), Winnow's picks only.
 */
export function carouselReport(list: readonly RecapPicture[], c: Pick<RecapCarousel, 'left' | 'rules' | 'burstPick' | 'picksOnly'>, places = Infinity): PoolReport {
  const rank = rankByRules(c.rules.prefer);
  const removed = new Set(c.left);
  let kept = list.filter((p) => !removed.has(p.key));
  const left = { screen: 0, burst: 0, alike: 0 };
  if (leaves(c.rules, 'screen')) kept = kept.filter((p) => (factsOf(p).screen ? (left.screen++, false) : true));
  if (leaves(c.rules, 'burst')) {
    const bursts = burstsOf(kept);
    const leads = new Set<string>();
    for (const [id, members] of burstMembers(kept, bursts)) {
      const picked = members.find((m) => m.key === c.burstPick[id]);
      leads.add((picked ?? rank(members)[0]).key);
    }
    kept = kept.filter((p) => (!bursts.has(p.key) || leads.has(p.key) ? true : (left.burst++, false)));
  }
  if (leaves(c.rules, 'alike')) {
    // Best first: a picture is left out when it looks like one already kept.
    const keep: (PictureFacts & { key: string })[] = [];
    const out = new Set<string>();
    for (const p of rank(kept)) {
      const f = factsOf(p);
      if (keep.some((k) => looksAlike(f, k))) {
        out.add(p.key);
        left.alike++;
      } else keep.push(f);
    }
    kept = kept.filter((p) => !out.has(p.key));
  }
  const picks = kept.filter((p) => p.picked).length;
  const favs = kept.filter((p) => p.fav).length;
  // By itself: the ♥ when they fill the places, else the picks when they do, else everything (fewer places than asked
  // with the ♥ only — never filled with what he did not mark).
  const drawFrom: boolean | 'favs' = c.picksOnly ?? (favs > 0 && favs >= places ? 'favs' : picks > 0 && picks >= places);
  const pool = drawFrom === 'favs' ? kept.filter((p) => p.fav) : drawFrom ? kept.filter((p) => p.picked) : kept;
  return { pool, left, picksOnly: drawFrom === true, favsOnly: drawFrom === 'favs', drawFrom, picks, favs };
}

/** The pool alone (`carouselReport`). */
export function carouselPool(list: readonly RecapPicture[], c: Pick<RecapCarousel, 'left' | 'rules' | 'burstPick' | 'picksOnly'>, places = Infinity): RecapPicture[] {
  return carouselReport(list, c, places).pool;
}
