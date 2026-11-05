/**
 * The Sheets (lab 4, his yes of 2026-11-05): a period laid out on ONE sheet
 * as wide as the whole carousel, cut into slides. Instagram shows it a slide
 * at a time; a picture across a cut shows half of itself, so people swipe.
 *
 * - Four arrangements: **rows** (the default: two or three rows the whole
 *   length, each picture at its shape, in time order left to right),
 *   **collage** (prints scattered and turned), **film** (one band of frames)
 *   and **timeline** (each picture hung on its day).
 * - **The cuts**: a picture with a face never crosses one (Winnow counts
 *   faces), and at most one picture crosses each cut — the others move to
 *   the side their middle is on, and their row is justified again.
 * - **The slides** are counted from the pictures (about five a slide after
 *   the cover), or set (2–10).
 * - **The Reel** is a camera along the sheet: pausing on each slide with a
 *   glide between, or one continuous travelling shot (`sheetView`).
 *
 * Pure: geometry in sheet pixels (slide `i` spans `[i·W, (i+1)·W)`).
 */

export type SheetArrangement = 'rows' | 'collage' | 'film' | 'timeline';
export const SHEET_ARRANGEMENTS: readonly SheetArrangement[] = ['rows', 'collage', 'film', 'timeline'];
export const SHEET_ARRANGEMENT_LABEL: Record<SheetArrangement, string> = { rows: 'Rows', collage: 'Collage', film: 'Film strip', timeline: 'Timeline' };

export type SheetCamera = 'stops' | 'glide';

/** Rows (lab 6): how many (null = two on a post, three on a Story), the top row big, justified or loose, the margin above and below (a fraction of the page's height). */
export interface SheetRows {
  rows: number | null;
  big: boolean;
  loose: boolean;
  margin: number;
}
/** Collage: how much the prints overlap (0–1), their tilt (degrees), how many are big (0–1), their border. */
export interface SheetCollage {
  density: number;
  tilt: number;
  spread: number;
  border: 'white' | 'thin' | 'none';
}
/** Film strip: one or two strips, the frames' shape, the strips' place, the film's edge print (frame numbers and date). */
export interface SheetFilm {
  strips: 1 | 2;
  shape: '3:2' | '1:1' | '4:5';
  where: 'high' | 'centre' | 'low';
  edge: boolean;
}
/** Timeline: true time or even spacing, both sides of the line or one, sizes by stars, the days marked. */
export interface SheetTimeline {
  spacing: 'time' | 'even';
  sides: 'both' | 'one';
  stars: boolean;
  days: boolean;
}
/** A slide's own layout, taking over its stretch of the sheet: one picture edge to edge, two, or none and a line of his. */
export type SheetOwnLayout = 'hero' | 'pair' | 'breather';
export const SHEET_OWN_LAYOUTS: readonly SheetOwnLayout[] = ['hero', 'pair', 'breather'];
export interface SheetOwn {
  layout: SheetOwnLayout;
  /** A breather's line. */
  text?: string;
}

export interface RecapSheet {
  arrangement: SheetArrangement;
  /** How many slides the sheet is cut into; null = counted from the pictures. */
  slides: number | null;
  camera: SheetCamera;
  /** Each arrangement's own settings, kept while another is shown (lab 6). */
  rows: SheetRows;
  collage: SheetCollage;
  film: SheetFilm;
  timeline: SheetTimeline;
  /** Slides with a layout of their own, by their index (never the cover, 0). */
  own: Record<string, SheetOwn>;
}

export const DEFAULT_SHEET: RecapSheet = {
  arrangement: 'rows',
  slides: null,
  camera: 'stops',
  rows: { rows: null, big: false, loose: false, margin: 0.09 },
  collage: { density: 0.5, tilt: 6, spread: 0.4, border: 'white' },
  film: { strips: 1, shape: '3:2', where: 'centre', edge: true },
  timeline: { spacing: 'time', sides: 'both', stars: true, days: true },
  own: {},
};
export const MIN_SHEET_SLIDES = 2;
export const MAX_SHEET_SLIDES = 10;
/** Pictures a slide holds when the count is the sheet's own. */
export const PER_SLIDE = 5;

const clampN = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = <T extends string | number | boolean>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d);
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function readSheet(raw: unknown): RecapSheet {
  const r = obj(raw);
  const d = DEFAULT_SHEET;
  const slides = typeof r.slides === 'number' && Number.isFinite(r.slides) ? Math.min(MAX_SHEET_SLIDES, Math.max(MIN_SHEET_SLIDES, Math.round(r.slides))) : null;
  const rw = obj(r.rows);
  const co = obj(r.collage);
  const fi = obj(r.film);
  const ti = obj(r.timeline);
  const own: Record<string, SheetOwn> = {};
  for (const [k, v] of Object.entries(obj(r.own)).slice(0, MAX_SHEET_SLIDES)) {
    const i = Number(k);
    const o = obj(v);
    if (!Number.isInteger(i) || i < 1 || i >= MAX_SHEET_SLIDES || !SHEET_OWN_LAYOUTS.includes(o.layout as SheetOwnLayout)) continue;
    own[String(i)] = { layout: o.layout as SheetOwnLayout, ...(typeof o.text === 'string' && o.text.trim() ? { text: o.text.slice(0, 160) } : {}) };
  }
  return {
    arrangement: pick(r.arrangement, SHEET_ARRANGEMENTS, d.arrangement),
    slides,
    camera: r.camera === 'glide' ? 'glide' : 'stops',
    rows: {
      rows: typeof rw.rows === 'number' && Number.isFinite(rw.rows) ? Math.min(4, Math.max(1, Math.round(rw.rows))) : null,
      big: rw.big === true,
      loose: rw.loose === true,
      margin: clampN(rw.margin, 0.02, 0.2, d.rows.margin),
    },
    collage: {
      density: clampN(co.density, 0, 1, d.collage.density),
      tilt: clampN(co.tilt, 0, 12, d.collage.tilt),
      spread: clampN(co.spread, 0, 1, d.collage.spread),
      border: pick(co.border, ['white', 'thin', 'none'] as const, d.collage.border),
    },
    film: {
      strips: fi.strips === 2 ? 2 : 1,
      shape: pick(fi.shape, ['3:2', '1:1', '4:5'] as const, d.film.shape),
      where: pick(fi.where, ['high', 'centre', 'low'] as const, d.film.where),
      edge: typeof fi.edge === 'boolean' ? fi.edge : d.film.edge,
    },
    timeline: {
      spacing: ti.spacing === 'even' ? 'even' : 'time',
      sides: ti.sides === 'one' ? 'one' : 'both',
      stars: typeof ti.stars === 'boolean' ? ti.stars : d.timeline.stars,
      days: typeof ti.days === 'boolean' ? ti.days : d.timeline.days,
    },
    own,
  };
}

/** The slides a sheet of `pictures` is cut into: the cover, then about five a slide — or the count set. */
export function sheetSlides(pictures: number, set: number | null): number {
  if (set !== null) return Math.min(MAX_SHEET_SLIDES, Math.max(MIN_SHEET_SLIDES, set));
  return Math.min(MAX_SHEET_SLIDES, Math.max(MIN_SHEET_SLIDES, 1 + Math.ceil(pictures / PER_SLIDE)));
}

export interface SheetItem {
  id: string;
  /** Width over height; 1 when unknown. */
  aspect: number;
  /** Faces Winnow found; a picture with one never crosses a cut. */
  faces: number;
  /** Its place in the period, 0–1 (the timeline's x). */
  when: number;
  /** Its stars, a pick counting as five — a timeline's size by stars. */
  score?: number;
  /** Its day, for the film's edge print and the timeline's marks («12 Oct»). */
  label?: string;
}

export interface SheetBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians — a collage's turned print. */
  rot: number;
}

export interface SheetArea {
  /** Slides and their size. */
  slides: number;
  W: number;
  H: number;
  /** Where pictures may go on the sheet: from `x0` (the cover keeps its left for the title) to `x1`, between `y0` and `y1`. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  gap: number;
  /** Rows a «rows» sheet runs by default: two on a feed post, three on a Story. */
  rows: number;
}

/** A word printed on the sheet: the film's edge print, the timeline's day. */
export interface SheetMark {
  x: number;
  y: number;
  text: string;
}

/** What the painter draws behind the pictures, in sheet pixels: a film strip's band, the timeline's line, and their marks. */
export type SheetDecorItem = { kind: 'band'; x0: number; x1: number; y: number; h: number } | { kind: 'line'; x0: number; x1: number; y: number } | { kind: 'marks'; marks: SheetMark[]; size: number; colour: 'film' | 'ink' };

/** A slide that keeps a layout of its own (`SheetOwn`), its pictures' boxes, and a breather's line. */
export interface SheetOwnSlide {
  index: number;
  layout: SheetOwnLayout;
  text?: string;
}

export interface SheetLayout {
  boxes: SheetBox[];
  decor: SheetDecorItem[];
  /** The cuts, in sheet pixels. */
  cuts: number[];
  own: SheetOwnSlide[];
}

const crosses = (b: { x: number; w: number }, c: number) => b.x < c - 0.5 && b.x + b.w > c + 0.5;

/**
 * The cut rule: for each cut, at most one picture crosses it, never one with
 * a face. Returns, for each picture that must leave a cut, the side it goes
 * to (−1 left, +1 right) and the cut — the arrangement places it there.
 */
export function cutMoves(boxes: readonly (SheetBox & { faces: number })[], cuts: readonly number[]): Map<string, { cut: number; side: -1 | 1 }> {
  const out = new Map<string, { cut: number; side: -1 | 1 }>();
  for (const c of cuts) {
    const on = boxes.filter((b) => crosses(b, c));
    const keep = on.find((b) => b.faces === 0);
    for (const b of on) {
      if (b === keep) continue;
      out.set(b.id, { cut: c, side: b.x + b.w / 2 < c ? -1 : 1 });
    }
  }
  return out;
}

/** Widths in proportion to `natural` filling `span` (or, `loose`, at their own width unless that overflows), `gap` between. */
function justify(natural: readonly number[], span: number, gap: number, loose = false): number[] {
  const sum = natural.reduce((a, b) => a + b, 0);
  const room = Math.max(1, span - gap * Math.max(0, natural.length - 1));
  const k = sum > 0 ? (loose ? Math.min(1, room / sum) : room / sum) : 1;
  return natural.map((n) => (sum > 0 ? n * k : room / natural.length));
}

/**
 * Pictures in rows (or strips of film): each next picture goes to the row
 * that ends first, so time reads left to right across them; each row is
 * justified to its span (or left loose); then the cut rule splits a row at
 * the cut where a picture had to leave it, and each part is justified again.
 */
function rowLayout(items: readonly SheetItem[], x0: number, x1: number, rowsY: readonly { y: number; h: number }[], gap: number, aspectOf: (i: SheetItem) => number, cuts: readonly number[], loose: boolean): SheetBox[] {
  const rows = rowsY.length;
  const lanes: SheetItem[][] = Array.from({ length: rows }, () => []);
  const ends = Array<number>(rows).fill(0);
  for (const it of items) {
    let r = 0;
    for (let k = 1; k < rows; k++) if (ends[k] < ends[r] - 0.5) r = k;
    lanes[r].push(it);
    ends[r] += aspectOf(it) * rowsY[r].h + gap;
  }
  const place = (lane: SheetItem[], from: number, to: number, r: number): SheetBox[] => {
    const ws = justify(
      lane.map((it) => aspectOf(it) * rowsY[r].h),
      to - from,
      gap,
      loose,
    );
    let x = from;
    return lane.map((it, i) => {
      const b = { id: it.id, x, y: rowsY[r].y, w: ws[i], h: rowsY[r].h, rot: 0 };
      x += ws[i] + gap;
      return b;
    });
  };
  const byId = new Map(items.map((it) => [it.id, it]));
  const first = lanes.map((lane, r) => place(lane, x0, x1, r));
  const moves = cutMoves(
    first.flat().map((b) => ({ ...b, faces: byId.get(b.id)!.faces })),
    cuts,
  );
  const out: SheetBox[] = [];
  first.forEach((boxes, r) => {
    // This row's boundaries: the cuts a picture of it had to leave.
    const bounds = [...new Set(boxes.flatMap((b) => (moves.has(b.id) ? [moves.get(b.id)!.cut] : [])))].sort((p, q) => p - q);
    if (!bounds.length) {
      out.push(...boxes);
      return;
    }
    const edges = [x0, ...bounds, x1];
    const parts: SheetItem[][] = edges.slice(1).map(() => []);
    for (const b of boxes) {
      const m = moves.get(b.id);
      const mid = m ? (m.side < 0 ? m.cut - 1 : m.cut + 1) : b.x + b.w / 2;
      let k = 0;
      while (k < bounds.length && mid > bounds[k]) k++;
      parts[k].push(byId.get(b.id)!);
    }
    parts.forEach((part, k) => {
      if (!part.length) return;
      out.push(...place(part, edges[k] + (k > 0 ? gap / 2 : 0), edges[k + 1] - (k < parts.length - 1 ? gap / 2 : 0), r));
    });
  });
  return out;
}

/** A free placement (collage, timeline) moved off a cut by the rule: the whole picture to its side. */
function freeCuts(boxes: SheetBox[], items: ReadonlyMap<string, SheetItem>, cuts: readonly number[], gap: number): SheetBox[] {
  const moves = cutMoves(
    boxes.map((b) => ({ ...b, faces: items.get(b.id)!.faces })),
    cuts,
  );
  return boxes.map((b) => {
    const m = moves.get(b.id);
    if (!m) return b;
    return { ...b, x: m.side < 0 ? m.cut - gap - b.w : m.cut + gap };
  });
}

/** A seeded wobble in −1…1, the same every time for the same index. */
const wobble = (i: number, k: number) => Math.sin(i * 12.9898 + k * 78.233) * 0.5 + Math.sin(i * 3.7 + k * 1.3) * 0.5;

const aspectIn = (it: SheetItem) => Math.min(2.4, Math.max(0.5, it.aspect || 1));

/** One stretch of the sheet (between slides kept by their own layout) under the arrangement and its settings. */
function arrangeStretch(items: readonly SheetItem[], a: SheetArea, x0: number, x1: number, sheet: RecapSheet, cuts: readonly number[], numberFrom: number): { boxes: SheetBox[]; decor: SheetDecorItem[] } {
  const byId = new Map(items.map((it) => [it.id, it]));
  if (!items.length) return { boxes: [], decor: [] };
  if (sheet.arrangement === 'rows') {
    const set = sheet.rows;
    const rows = set.rows ?? a.rows;
    const y0 = Math.max(a.y0, set.margin * a.H);
    const y1 = a.H - Math.max(a.H - a.y1, set.margin * a.H);
    const room = y1 - y0 - a.gap * (rows - 1);
    // The big row: the top one twice the others.
    const unit = room / (rows + (set.big && rows > 1 ? 1 : 0));
    let y = y0;
    const rowsY = Array.from({ length: rows }, (_, r) => {
      const h = set.big && rows > 1 && r === 0 ? unit * 2 : unit;
      const out = { y, h };
      y += h + a.gap;
      return out;
    });
    return { boxes: rowLayout(items, x0, x1, rowsY, a.gap, aspectIn, cuts, set.loose), decor: [] };
  }
  if (sheet.arrangement === 'film') {
    const f = sheet.film;
    const [aw, ah] = f.shape.split(':').map(Number);
    const strips = f.strips;
    const bandH = Math.min((a.y1 - a.y0) / strips - a.gap, a.H * (strips === 2 ? 0.3 : 0.42));
    const total = strips * bandH + (strips - 1) * a.gap * 2;
    const centre = f.where === 'high' ? a.y0 + total / 2 : f.where === 'low' ? a.y1 - total / 2 : (a.y0 + a.y1) / 2;
    const bands = Array.from({ length: strips }, (_, i) => ({ y: centre - total / 2 + i * (bandH + a.gap * 2), h: bandH }));
    const rowsY = bands.map((b) => ({ y: b.y + bandH * 0.13, h: bandH * 0.74 }));
    const frames = rowLayout(items, x0, x1, rowsY, a.gap, () => aw / ah, cuts, false);
    const decor: SheetDecorItem[] = bands.map((b) => ({ kind: 'band', x0: x0 - a.gap * 2, x1: x1 + a.gap * 2, y: b.y, h: b.h }));
    if (f.edge) {
      const order = new Map(items.map((it, i) => [it.id, i]));
      decor.push({
        kind: 'marks',
        size: bandH * 0.075,
        colour: 'film',
        marks: frames.map((b) => ({ x: b.x, y: b.y + b.h + bandH * 0.095, text: `${numberFrom + order.get(b.id)! + 1} ▸ ${byId.get(b.id)!.label ?? ''}` })),
      });
    }
    return { boxes: frames, decor };
  }
  if (sheet.arrangement === 'collage') {
    const c = sheet.collage;
    const span = x1 - x0;
    const step = span / items.length;
    const boxes = items.map((it, i) => {
      // Size spread: some prints half again as big; density: how far each reaches over its neighbour.
      const big = (wobble(i, 5) + 1) / 2 < c.spread * 0.5 ? 1.5 : 1;
      const h = Math.min((a.y1 - a.y0) * 0.8, (a.y1 - a.y0) * (0.3 + 0.1 * (wobble(i, 1) + 1)) * big * (0.85 + c.density * 0.4));
      const w = Math.min(h * aspectIn(it), step * (1.4 + c.density * 1.6));
      const x = x0 + i * step + step / 2 - w / 2 + wobble(i, 2) * step * 0.25;
      const y = a.y0 + (a.y1 - a.y0 - h) * (0.5 + 0.45 * wobble(i, 3));
      return { id: it.id, x: Math.max(x0, Math.min(x1 - w, x)), y, w, h, rot: (wobble(i, 4) * c.tilt * Math.PI) / 180 };
    });
    return { boxes: freeCuts(boxes, byId, cuts, a.gap), decor: [] };
  }
  // The timeline: each picture at its moment (or evenly), above and below the line in turn (or above only).
  const t = sheet.timeline;
  const mid = t.sides === 'both' ? (a.y0 + a.y1) / 2 : a.y1 - (a.y1 - a.y0) * 0.12;
  const base = (a.y1 - a.y0) * (t.sides === 'both' ? 0.36 : 0.62);
  const lanes = [x0, x0];
  const boxes = items.map((it, i) => {
    const lane = t.sides === 'both' ? i % 2 : 0;
    const h = base * (t.stars ? 0.7 + 0.12 * Math.min(5, it.score ?? 0) : 1);
    const w = h * Math.min(1.4, aspectIn(it));
    const when = t.spacing === 'even' ? (items.length > 1 ? i / (items.length - 1) : 0.5) : it.when;
    const want = x0 + when * (x1 - x0 - w);
    const x = Math.min(x1 - w, Math.max(want, lanes[lane]));
    lanes[lane] = x + w + a.gap;
    return { id: it.id, x, y: lane === 0 ? mid - a.gap * 1.5 - h : mid + a.gap * 1.5, w, h, rot: 0 };
  });
  const laid = freeCuts(boxes, byId, cuts, a.gap);
  const decor: SheetDecorItem[] = [{ kind: 'line', x0: x0 - a.gap * 2, x1: x1 + a.gap * 2, y: mid }];
  if (t.days)
    decor.push({
      kind: 'marks',
      size: a.H * 0.016,
      colour: 'ink',
      marks: laid.map((b) => ({ x: b.x + b.w / 2, y: b.y < mid ? mid + a.H * 0.028 : mid - a.H * 0.012, text: byId.get(b.id)!.label ?? '' })),
    });
  return { boxes: laid, decor };
}

/**
 * The sheet laid out: every picture's box in sheet pixels, the decor, the
 * cuts, the slides kept by their own layout. Those slides take over their
 * stretch — the arrangement stops at their left cut and starts again at
 * their right one — and the pictures go to each part in time order: one to a
 * hero, two to a pair, none to a breather, the rest shared by width.
 */
export function arrangeSheet(items: readonly SheetItem[], a: SheetArea, sheet: RecapSheet): SheetLayout {
  const cuts = Array.from({ length: a.slides - 1 }, (_, i) => (i + 1) * a.W);
  const ownIndex = (i: number) => (i >= 1 && i < a.slides ? sheet.own[String(i)] : undefined);
  type Part = { kind: 'stretch'; x0: number; x1: number } | { kind: 'own'; index: number; own: SheetOwn };
  const parts: Part[] = [];
  let start = a.x0;
  for (let i = 1; i < a.slides; i++) {
    const own = ownIndex(i);
    if (!own) continue;
    if (i * a.W - a.gap - start > a.W * 0.25) parts.push({ kind: 'stretch', x0: start, x1: i * a.W - a.gap });
    parts.push({ kind: 'own', index: i, own });
    start = (i + 1) * a.W + a.gap;
  }
  if (a.x1 - start > a.W * 0.25) parts.push({ kind: 'stretch', x0: start, x1: a.x1 });
  const need = (o: SheetOwn) => (o.layout === 'hero' ? 1 : o.layout === 'pair' ? 2 : 0);
  const ownNeed = parts.reduce((n, p) => n + (p.kind === 'own' ? need(p.own) : 0), 0);
  const free = Math.max(0, items.length - ownNeed);
  const stretchWidth = parts.reduce((w, p) => w + (p.kind === 'stretch' ? p.x1 - p.x0 : 0), 0) || 1;
  const boxes: SheetBox[] = [];
  const decor: SheetDecorItem[] = [];
  const own: SheetOwnSlide[] = [];
  let at = 0;
  let given = 0;
  let widthSeen = 0;
  for (const p of parts) {
    if (p.kind === 'stretch') {
      widthSeen += p.x1 - p.x0;
      const upto = Math.round((free * widthSeen) / stretchWidth);
      const take = Math.max(0, upto - given);
      given += take;
      const list = items.slice(at, at + take);
      const laid = arrangeStretch(
        list,
        a,
        p.x0,
        p.x1,
        sheet,
        cuts.filter((c) => c > p.x0 && c < p.x1),
        at,
      );
      at += list.length;
      boxes.push(...laid.boxes);
      decor.push(...laid.decor);
      continue;
    }
    const left = p.index * a.W;
    const list = items.slice(at, at + need(p.own));
    at += list.length;
    own.push({ index: p.index, layout: p.own.layout, ...(p.own.text ? { text: p.own.text } : {}) });
    if (p.own.layout === 'hero' && list[0]) boxes.push({ id: list[0].id, x: left, y: 0, w: a.W, h: a.H, rot: 0 });
    if (p.own.layout === 'pair') {
      const m = a.W * 0.06;
      // Side by side on a feed post, one above the other on a Story.
      const stacked = a.H > a.W * 1.4;
      list.forEach((it, k) => {
        const w = stacked ? a.W - 2 * m : (a.W - 2 * m - a.gap) / 2;
        const h = stacked ? (a.y1 - a.y0 - a.gap) / 2 : a.y1 - a.y0;
        boxes.push({ id: it.id, x: left + m + (stacked ? 0 : k * (w + a.gap)), y: a.y0 + (stacked ? k * (h + a.gap) : 0), w, h, rot: 0 });
      });
    }
  }
  // What no part took (a breather too many): onto the last stretch, so no picture is lost.
  if (at < items.length) {
    const last = [...parts].reverse().find((p): p is Extract<Part, { kind: 'stretch' }> => p.kind === 'stretch');
    if (last) {
      const laid = arrangeStretch(items.slice(at), a, last.x0, last.x1, sheet, [], at);
      boxes.push(...laid.boxes);
    }
  }
  return { boxes, decor, cuts, own };
}

/**
 * Where the Reel's camera is at film time `t`: the slide on the left of the
 * view and how far the view has moved into the next (0–1). `stops` holds
 * each slide and glides into the next over its last `glide` seconds;
 * `glide` travels the whole sheet at one pace.
 */
export function sheetView(pages: readonly { start: number; length: number }[], total: number, t: number, camera: SheetCamera, glide = 0.7): { page: number; frac: number } {
  const n = pages.length;
  if (n <= 1) return { page: 0, frac: 0 };
  if (camera === 'glide') {
    const at = Math.min(n - 1, Math.max(0, (t / Math.max(0.001, total)) * (n - 1)));
    const page = Math.min(n - 2, Math.floor(at));
    return { page, frac: at - page };
  }
  let k = 0;
  for (let i = n - 1; i >= 0; i--) if (t >= pages[i].start) {
    k = i;
    break;
  }
  if (k >= n - 1) return { page: n - 1, frac: 0 };
  const end = pages[k].start + pages[k].length;
  const g = Math.min(glide, pages[k].length * 0.5);
  const u = (t - (end - g)) / g;
  if (u <= 0) return { page: k, frac: 0 };
  const e = Math.min(1, u);
  return { page: k, frac: e * e * (3 - 2 * e) };
}
