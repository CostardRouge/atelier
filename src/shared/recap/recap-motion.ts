/**
 * How a recap MOVES: when the heading and each cell enter, in which order,
 * with which entrance, when each clip plays, and how long the film lasts — a
 * function of time the stage and the export both read, so the preview IS the
 * film (Storytelling's and Mosaic's rule: one clock, painted twice).
 *
 * Pure and DOM-free.
 */

import { seededOrder } from './recap-slots';
import type { CellEntrance, CellOrder, RecapDoc, TitleEntrance } from './recap-doc';
import type { Box, CellPart, RecapLayout, RecapPage } from './recap-layout';
import type { OpenerPlan } from './recap-opener-plan';
import { beatGrid, onTheBeat } from './recap-beat';
import { secondPlan } from './recap-second';
import { bandSeconds, type BandSpan } from './recap-bands';

/** A window of the film, in seconds. */
export interface Span {
  at: number;
  dur: number;
}

export interface PagePlan {
  /** When the page starts in the film. */
  start: number;
  /** How long it lasts. */
  length: number;
  heading: Span | null;
  subheading: Span | null;
  cta: Span | null;
  /** Each cell's entrance, by slot. */
  cells: Map<string, Span>;
  /** When each clip plays (by slot): its windows, film time — `offset` the clip's own second it starts at (one second a day plays a clip's middle). */
  clips: Map<string, ClipWindow[]>;
  /** When everything is on. */
  allOn: number;
  /** A week's bands taking their turns (`recap-bands.ts`). */
  bands?: BandSpan;
}

export interface ClipWindow {
  from: number;
  to: number;
  offset?: number;
}

export interface FilmPlan {
  pages: PagePlan[];
  /** The whole film, the opener included. */
  total: number;
  /** The opener's seconds before the first page (`recap-opener.ts`); every page is shifted by it. */
  lead?: number;
  opener?: OpenerPlan | null;
}

export const HEADING_AT = 0.25;
export const HEADING_DUR = 0.8;
const CELL_DUR: Record<CellEntrance, number> = { none: 0, fade: 0.5, slide: 0.55, pop: 0.5, drop: 0.7, develop: 1.1, flicker: 0.6 };
/** A clip plays this long at most in its turn — a recap is not a reel of whole clips. */
export const CLIP_TURN_MAX = 5;
/** The zoom in and out of `zoom`. */
export const ZOOM_EASE = 0.45;

/**
 * Each cell's rank in the entrance: in reading order, at random (seeded), as
 * a wave from the top-left corner, column by column, or as a spiral out of
 * the middle.
 */
export function cellRanks(cells: readonly CellPart[], order: CellOrder, seed: number): Map<string, number> {
  const idx = cells.map((c, i) => ({ c, i }));
  let sorted: { c: CellPart; i: number }[];
  switch (order) {
    case 'random': {
      const perm = seededOrder(cells.length, seed);
      sorted = perm.map((i) => idx[i]);
      break;
    }
    case 'wave':
      sorted = idx.slice().sort((a, b) => a.c.col + a.c.row - (b.c.col + b.c.row) || a.c.row - b.c.row || a.i - b.i);
      break;
    case 'columns':
      sorted = idx.slice().sort((a, b) => a.c.col - b.c.col || a.c.row - b.c.row || a.i - b.i);
      break;
    case 'spiral': {
      const cx = cells.reduce((s, c) => s + c.box.x + c.box.w / 2, 0) / Math.max(1, cells.length);
      const cy = cells.reduce((s, c) => s + c.box.y + c.box.h / 2, 0) / Math.max(1, cells.length);
      const key = (c: CellPart) => {
        const dx = c.box.x + c.box.w / 2 - cx;
        const dy = c.box.y + c.box.h / 2 - cy;
        return Math.hypot(dx, dy) + (Math.atan2(dy, dx) + Math.PI) * 4;
      };
      sorted = idx.slice().sort((a, b) => key(a.c) - key(b.c) || a.i - b.i);
      break;
    }
    default:
      sorted = idx;
  }
  const out = new Map<string, number>();
  sorted.forEach((x, rank) => out.set(x.c.id, rank));
  return out;
}

/** What a cell needs to know about its clip: how long it runs, when it has one. */
export type ClipLength = (slot: string) => number | null;
/** Whether a slot shows a picture — an empty day takes no turn in the entrance. */
export type Filled = (slot: string) => boolean;

/** The slots of `resolved` that show a picture, as a `Filled`. */
export function filledOf(resolved: { slots: readonly { id: string; picture: unknown }[] }): Filled {
  const ids = new Set(resolved.slots.filter((s) => s.picture).map((s) => s.id));
  return (slot) => ids.has(slot);
}

function planPage(doc: RecapDoc, page: RecapPage, start: number, first: boolean, clipLength: ClipLength, filled: Filled): PagePlan {
  const m = doc.motion;
  const texts = page.parts.filter((p) => p.kind === 'text');
  const hasHeading = texts.some((p) => p.role === 'heading');
  const hasSub = texts.some((p) => p.role === 'subheading');
  const titleOn = m.title !== 'none';
  const heading = hasHeading ? { at: start + (titleOn ? HEADING_AT : 0), dur: titleOn ? HEADING_DUR : 0 } : null;
  const subheading = hasSub ? { at: start + (titleOn ? HEADING_AT + 0.3 : 0), dur: titleOn ? HEADING_DUR : 0 } : null;
  // Only the cells with a picture ENTER: an empty day is there from the start, with the grid, and the wave runs
  // through the pictures with no gap where a day is empty.
  const cellsOf = page.parts.filter((p): p is CellPart => p.kind === 'cell' && filled(p.id));
  const ranks = cellRanks(cellsOf, m.order, m.seed);
  const dur = CELL_DUR[m.entrance];
  const cellsStart = start + (m.entrance === 'none' ? 0 : (first && titleOn && hasHeading ? HEADING_AT + 0.45 : 0.2));
  const cells = new Map<string, Span>();
  let allOn = Math.max(heading ? heading.at + heading.dur : start, subheading ? subheading.at + subheading.dur : start);
  for (const c of cellsOf) {
    const at = cellsStart + (ranks.get(c.id) ?? 0) * m.stagger;
    cells.set(c.id, { at, dur });
    allOn = Math.max(allOn, at + dur);
  }
  const cta = texts.some((p) => p.role === 'cta') ? { at: allOn, dur: titleOn ? 0.5 : 0 } : null;
  if (cta) allOn = cta.at + cta.dur;
  const clips = new Map<string, { from: number; to: number }[]>();
  let clipsEnd = allOn;
  // The clips in the order they appear on the page.
  const withClips = cellsOf
    .map((c) => ({ c, len: clipLength(c.id) }))
    .filter((x): x is { c: CellPart; len: number } => x.len !== null && x.len > 0)
    .sort((a, b) => (ranks.get(a.c.id) ?? 0) - (ranks.get(b.c.id) ?? 0));
  if (m.videos === 'turn' || m.videos === 'zoom') {
    let t = allOn + 0.2;
    for (const { c, len } of withClips) {
      const play = Math.min(len, CLIP_TURN_MAX) + (m.videos === 'zoom' ? 2 * ZOOM_EASE : 0);
      clips.set(c.id, [{ from: t, to: t + play }]);
      t += play + 0.15;
    }
    clipsEnd = t;
  } else if (m.videos === 'together') {
    for (const { c } of withClips) {
      const span = cells.get(c.id);
      clips.set(c.id, [{ from: span?.at ?? allOn, to: Number.POSITIVE_INFINITY }]);
    }
  }
  // A week's bands take their turns once everything is on (lab 8); the page lasts until they rest again.
  const bands = doc.template === 'week' && page.key === 'first' && m.bands !== 'none' ? { from: allOn + 0.2, hold: m.bandHold } : undefined;
  const end = Math.max(allOn + m.hold, clipsEnd + 0.4, bands ? bands.from + bandSeconds(bands.hold) + 0.4 : 0);
  // `together` plays to the page's end: its windows close there.
  for (const [k, w] of clips) clips.set(k, w.map((x) => ({ ...x, to: Math.min(x.to, end) })));
  return { start, length: end - start, heading, subheading, cta, cells, clips, allOn, ...(bands ? { bands } : {}) };
}

/** How a template's pages are timed: one second a day has its own clock (`recap-second.ts`). */
function pagesPlanner(doc: RecapDoc): (doc: RecapDoc, layout: RecapLayout, clipLength: ClipLength, filled: Filled) => FilmPlan {
  return doc.template === 'second' ? (d, l, c) => secondPlan(d, l, c) : planPages;
}

/**
 * The whole film: its pages one after the other (a dump's pages are a
 * slideshow; every other template is one page), stretched, when the sound
 * asks for it, to a whole number of the sound's loops so the music ends on
 * its own seam.
 */
function planPages(doc: RecapDoc, layout: RecapLayout, clipLength: ClipLength, filled: Filled): FilmPlan {
  const pages: PagePlan[] = [];
  let t = 0;
  layout.pages.forEach((page, i) => {
    const plan = planPage(doc, page, t, i === 0, clipLength, filled);
    pages.push(plan);
    t += plan.length;
  });
  return { pages, total: Math.max(0.5, t) };
}

const scaleSpan = (s: Span, k: number): Span => ({ at: s.at * k, dur: s.dur * k });

/** The whole plan run `k` times as fast (k < 1 is faster): every entrance, turn and page shortened alike. */
function scalePlan(plan: FilmPlan, k: number): FilmPlan {
  return {
    total: plan.total * k,
    pages: plan.pages.map((p) => ({
      start: p.start * k,
      length: p.length * k,
      heading: p.heading && scaleSpan(p.heading, k),
      subheading: p.subheading && scaleSpan(p.subheading, k),
      cta: p.cta && scaleSpan(p.cta, k),
      cells: new Map([...p.cells].map(([id, s]) => [id, scaleSpan(s, k)])),
      clips: new Map([...p.clips].map(([id, ws]) => [id, ws.map((w) => ({ ...w, from: w.from * k, to: w.to * k }))])),
      allOn: p.allOn * k,
      ...(p.bands ? { bands: { from: p.bands.from * k, hold: p.bands.hold * k } } : {}),
    })),
  };
}

/**
 * The whole film: its pages one after the other (a dump's pages are a
 * slideshow; every other template is one page). Its length is the author's
 * when set (`doc.length`): longer, every page HOLDS longer; shorter, the whole
 * film plays faster, entrances and turns alike. Else, when the sound asks for
 * it, it is stretched to a whole number of the sound's loops so the music ends
 * on its own seam.
 */
export function planFilm(doc: RecapDoc, layout: RecapLayout, clipLength: ClipLength = () => null, filled: Filled = () => true, opener: OpenerPlan | null = null): FilmPlan {
  const lead = opener ? Math.max(0, opener.seconds) : 0;
  const plan = planBody(doc, layout, clipLength, filled, lead);
  const led: FilmPlan = lead > 0 ? { ...shiftPlan(plan, lead), lead, opener } : { ...plan, lead: 0, opener: null };
  // On the beat (`recap-beat.ts`): the cuts and entrances land on the sound's beats, the end on a bar.
  const beat = doc.motion.onBeat ? doc.sound?.beat : null;
  if (!beat || !doc.sound) return led;
  const grid = beatGrid(beat, doc.sound.seconds, led.total + beat.period * 12 + 1);
  return onTheBeat(led, grid, doc.length);
}

/** The recap's own pages, `lead` seconds short of the author's length (the opener counts in it), or fitted to the sound's loops with the opener. */
function planBody(doc: RecapDoc, layout: RecapLayout, clipLength: ClipLength, filled: Filled, lead: number): FilmPlan {
  const planPages = pagesPlanner(doc);
  const natural = planPages(doc, layout, clipLength, filled);
  if (doc.length !== null && doc.length > 0) {
    const want = Math.max(1, doc.length - lead);
    if (natural.total > want) return { ...scalePlan(natural, want / natural.total), total: want };
    if (natural.total < want) {
      const n = Math.max(1, natural.pages.length);
      const longer = planPages({ ...doc, motion: { ...doc.motion, hold: doc.motion.hold + (want - natural.total) / n } }, layout, clipLength, filled);
      // A clip's turn may not stretch with the hold: what is left lands on the last page.
      const last = longer.pages[longer.pages.length - 1];
      if (last) last.length += want - longer.total;
      return { pages: longer.pages, total: want };
    }
    return natural;
  }
  const { pages } = natural;
  let total = natural.total;
  const s = doc.sound;
  if (s && s.fit && s.seconds >= 0.5) {
    const whole = total + lead;
    const turns = Math.max(1, Math.round(whole / s.seconds));
    let fitted = turns * s.seconds;
    if (fitted < lead + (pages[pages.length - 1]?.allOn ?? 0) + 0.5) fitted += s.seconds;
    // A long song is not a reason for a long recap: past twice the recap's own length the sound is cut instead.
    if (fitted <= whole * 2) {
      const last = pages[pages.length - 1];
      if (last) last.length += fitted - whole;
      total = fitted - lead;
    }
  }
  return { pages, total };
}

const shiftSpan = (s: Span, d: number): Span => ({ at: s.at + d, dur: s.dur });

/** The plan `d` seconds later: what an opener in front of it does. */
function shiftPlan(plan: FilmPlan, d: number): FilmPlan {
  return {
    total: plan.total + d,
    pages: plan.pages.map((p) => ({
      start: p.start + d,
      length: p.length,
      heading: p.heading && shiftSpan(p.heading, d),
      subheading: p.subheading && shiftSpan(p.subheading, d),
      cta: p.cta && shiftSpan(p.cta, d),
      cells: new Map([...p.cells].map(([id, s]) => [id, shiftSpan(s, d)])),
      clips: new Map([...p.clips].map(([id, ws]) => [id, ws.map((w) => ({ ...w, from: w.from + d, to: w.to + d }))])),
      allOn: p.allOn + d,
      ...(p.bands ? { bands: { from: p.bands.from + d, hold: p.bands.hold } } : {}),
    })),
  };
}

/** The film's own length, before any length the author set — what the Export tab offers as *Auto*. */
export function naturalLength(doc: RecapDoc, layout: RecapLayout, clipLength: ClipLength = () => null, filled: Filled = () => true, opener: OpenerPlan | null = null): number {
  return planFilm({ ...doc, length: null }, layout, clipLength, filled, opener).total;
}

/** The page on screen at film time `t`. */
export function pageAt(plan: FilmPlan, t: number): number {
  for (let i = plan.pages.length - 1; i >= 0; i--) if (t >= plan.pages[i].start) return i;
  return 0;
}

// ---- how an entrance looks at a moment -------------------------------------------

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
const backOut = (x: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};
const bounceOut = (x: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};

export interface CellLook {
  /** 0 = not drawn. */
  alpha: number;
  /** Offsets in fractions of the cell's own size. */
  dx: number;
  dy: number;
  scale: number;
  /** A white veil over the picture, 1 = blank paper: the Polaroid that develops. */
  whiten: number;
}

const SHOWN: CellLook = { alpha: 1, dx: 0, dy: 0, scale: 1, whiten: 0 };

/** A cell's look `t` seconds into the film, for its entrance `span`. */
export function cellLook(entrance: CellEntrance, span: Span | undefined, t: number): CellLook {
  if (!span || entrance === 'none' || span.dur <= 0) return SHOWN;
  const p = clamp01((t - span.at) / span.dur);
  if (t < span.at) return { alpha: 0, dx: 0, dy: 0, scale: 1, whiten: 0 };
  if (p >= 1) return SHOWN;
  const e = easeOut(p);
  switch (entrance) {
    case 'fade':
      return { ...SHOWN, alpha: e };
    case 'slide':
      return { ...SHOWN, alpha: e, dy: (1 - e) * 0.35 };
    case 'pop':
      return { ...SHOWN, alpha: clamp01(p * 3), scale: 0.55 + 0.45 * backOut(p) };
    case 'drop':
      return { ...SHOWN, alpha: clamp01(p * 4), dy: -(1 - bounceOut(p)) * 0.7 };
    case 'develop':
      // The print arrives blank and its picture rises out of the white.
      return { ...SHOWN, alpha: clamp01(p * 5), whiten: 1 - easeOut(clamp01((p - 0.1) / 0.9)) };
    case 'flicker':
      return { ...SHOWN, alpha: Math.floor(p * 9) % 2 === 0 ? 1 : 0.12 };
    default:
      return SHOWN;
  }
}

export interface TextLook {
  alpha: number;
  /** Offset in fractions of the text's own height. */
  dy: number;
  /** The share of its characters drawn (type on). */
  chars: number;
  /** The share of its width revealed (mask). */
  reveal: number;
}

/** A heading's look `t` seconds into the film. */
export function textLook(entrance: TitleEntrance, span: Span | null, t: number): TextLook {
  const shown = { alpha: 1, dy: 0, chars: 1, reveal: 1 };
  if (!span || entrance === 'none' || span.dur <= 0) return shown;
  if (t < span.at) return { alpha: 0, dy: 0, chars: 0, reveal: 0 };
  const p = clamp01((t - span.at) / span.dur);
  const e = easeOut(p);
  switch (entrance) {
    case 'fade':
      return { ...shown, alpha: e };
    case 'rise':
      return { ...shown, alpha: e, dy: (1 - e) * 0.6 };
    case 'type':
      return { ...shown, chars: p };
    case 'mask':
      return { ...shown, reveal: e };
    default:
      return shown;
  }
}

/** Where a playing cell stands in `zoom`: its box grown toward the page's middle, eased in and out. */
export function zoomedBox(box: Box, pageW: number, pageH: number, window: { from: number; to: number }, t: number): Box {
  if (t <= window.from || t >= window.to) return box;
  const k = easeOut(clamp01(Math.min((t - window.from) / ZOOM_EASE, (window.to - t) / ZOOM_EASE)));
  const m = pageW * 0.06;
  const aspect = box.w / box.h;
  let w = pageW - 2 * m;
  let h = w / aspect;
  if (h > pageH - 2 * m) {
    h = pageH - 2 * m;
    w = h * aspect;
  }
  const target = { x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
  return {
    x: box.x + (target.x - box.x) * k,
    y: box.y + (target.y - box.y) * k,
    w: box.w + (target.w - box.w) * k,
    h: box.h + (target.h - box.h) * k,
  };
}

/**
 * A clip's own time at film time `t`, or null when it shows its poster: in
 * its window it plays from its start (looping a short clip); outside, it
 * holds the frame it stopped on.
 */
export function clipTime(windows: readonly ClipWindow[] | undefined, length: number, t: number): number | null {
  if (!windows?.length || length <= 0) return null;
  for (const w of windows) if (t >= w.from && t < w.to) return ((w.offset ?? 0) + t - w.from) % length;
  return null;
}

/** The looping background's own time at film time `t`. */
export function loopTime(bg: { loopIn: number; loopOut: number | null; speed: number }, clipLength: number, t: number): number {
  const a = Math.min(Math.max(0, bg.loopIn), Math.max(0, clipLength - 0.05));
  const b = bg.loopOut !== null ? Math.min(bg.loopOut, clipLength) : clipLength;
  const span = Math.max(0.05, b - a);
  return a + ((t * bg.speed) % span);
}

/** True while a clip plays somewhere on the page at `t` — what `turn` rings. */
export function playingAt(plan: PagePlan, slot: string, t: number): boolean {
  return (plan.clips.get(slot) ?? []).some((w) => t >= w.from && t < w.to);
}
