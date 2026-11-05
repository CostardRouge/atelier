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

export interface RecapSheet {
  arrangement: SheetArrangement;
  /** How many slides the sheet is cut into; null = counted from the pictures. */
  slides: number | null;
  camera: SheetCamera;
}

export const DEFAULT_SHEET: RecapSheet = { arrangement: 'rows', slides: null, camera: 'stops' };
export const MIN_SHEET_SLIDES = 2;
export const MAX_SHEET_SLIDES = 10;
/** Pictures a slide holds when the count is the sheet's own. */
export const PER_SLIDE = 5;

export function readSheet(raw: unknown): RecapSheet {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SHEET };
  const r = raw as Record<string, unknown>;
  const slides = typeof r.slides === 'number' && Number.isFinite(r.slides) ? Math.min(MAX_SHEET_SLIDES, Math.max(MIN_SHEET_SLIDES, Math.round(r.slides))) : null;
  return {
    arrangement: SHEET_ARRANGEMENTS.includes(r.arrangement as SheetArrangement) ? (r.arrangement as SheetArrangement) : DEFAULT_SHEET.arrangement,
    slides,
    camera: r.camera === 'glide' ? 'glide' : 'stops',
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
  /** Rows a «rows» sheet runs: two on a feed post, three on a Story. */
  rows: number;
}

/** What the painter draws behind the pictures: the film's band, the timeline's line — in sheet pixels. */
export type SheetDecor = { kind: 'film'; y: number; h: number; x0: number } | { kind: 'timeline'; y: number; x0: number } | null;

export interface SheetLayout {
  boxes: SheetBox[];
  decor: SheetDecor;
  /** The cuts, in sheet pixels. */
  cuts: number[];
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

/** Widths fitted to `span` in proportion to `natural`, `gap` between. */
function justify(natural: readonly number[], span: number, gap: number): number[] {
  const sum = natural.reduce((a, b) => a + b, 0);
  const room = Math.max(1, span - gap * Math.max(0, natural.length - 1));
  return natural.map((n) => (sum > 0 ? (n / sum) * room : room / natural.length));
}

/**
 * Pictures in rows (or one band, the film): each next picture goes to the
 * row that ends first, so time reads left to right across them; each row is
 * justified to the sheet's length; then the cut rule splits a row at the cut
 * where a picture had to leave it, and each part is justified again.
 */
function rowLayout(items: readonly SheetItem[], a: SheetArea, rows: number, aspectOf: (i: SheetItem) => number, cuts: readonly number[]): SheetBox[] {
  const rowH = (a.y1 - a.y0 - a.gap * (rows - 1)) / rows;
  const lanes: SheetItem[][] = Array.from({ length: rows }, () => []);
  const ends = Array<number>(rows).fill(0);
  for (const it of items) {
    let r = 0;
    for (let k = 1; k < rows; k++) if (ends[k] < ends[r] - 0.5) r = k;
    lanes[r].push(it);
    ends[r] += aspectOf(it) * rowH + a.gap;
  }
  const place = (lane: SheetItem[], from: number, to: number, y: number): SheetBox[] => {
    const ws = justify(
      lane.map((it) => aspectOf(it) * rowH),
      to - from,
      a.gap,
    );
    let x = from;
    return lane.map((it, i) => {
      const b = { id: it.id, x, y, w: ws[i], h: rowH, rot: 0 };
      x += ws[i] + a.gap;
      return b;
    });
  };
  const out: SheetBox[] = [];
  const byId = new Map(items.map((it) => [it.id, it]));
  const first = lanes.map((lane, r) => place(lane, a.x0, a.x1, a.y0 + r * (rowH + a.gap)));
  const moves = cutMoves(
    first.flat().map((b) => ({ ...b, faces: byId.get(b.id)!.faces })),
    cuts,
  );
  first.forEach((boxes, r) => {
    const y = a.y0 + r * (rowH + a.gap);
    // This row's boundaries: the cuts a picture of it had to leave.
    const bounds = [...new Set(boxes.flatMap((b) => (moves.has(b.id) ? [moves.get(b.id)!.cut] : [])))].sort((p, q) => p - q);
    if (!bounds.length) {
      out.push(...boxes);
      return;
    }
    const edges = [a.x0, ...bounds, a.x1];
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
      const from = edges[k] + (k > 0 ? a.gap / 2 : 0);
      const to = edges[k + 1] - (k < parts.length - 1 ? a.gap / 2 : 0);
      out.push(...place(part, from, to, y));
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

/** The sheet laid out: every picture's box in sheet pixels, the decor, the cuts. */
export function arrangeSheet(items: readonly SheetItem[], a: SheetArea, arrangement: SheetArrangement): SheetLayout {
  const cuts = Array.from({ length: a.slides - 1 }, (_, i) => (i + 1) * a.W);
  const byId = new Map(items.map((it) => [it.id, it]));
  const aspect = (it: SheetItem) => Math.min(2.4, Math.max(0.5, it.aspect || 1));
  if (!items.length) return { boxes: [], decor: null, cuts };
  if (arrangement === 'rows') return { boxes: rowLayout(items, a, a.rows, aspect, cuts), decor: null, cuts };
  if (arrangement === 'film') {
    const bandH = Math.min(a.y1 - a.y0, a.H * 0.42);
    const y = (a.y0 + a.y1) / 2 - bandH / 2;
    const frames = rowLayout(items, { ...a, y0: y + bandH * 0.12, y1: y + bandH * 0.88 }, 1, () => 1.5, cuts);
    return { boxes: frames, decor: { kind: 'film', y, h: bandH, x0: a.x0 - a.gap * 2 }, cuts };
  }
  if (arrangement === 'collage') {
    const span = a.x1 - a.x0;
    const step = span / items.length;
    const boxes = items.map((it, i) => {
      const h = (a.y1 - a.y0) * (0.34 + 0.12 * (wobble(i, 1) + 1));
      const w = Math.min(h * aspect(it), step * 2.2);
      const x = a.x0 + i * step + step / 2 - w / 2 + wobble(i, 2) * step * 0.25;
      const y = a.y0 + (a.y1 - a.y0 - h) * (0.5 + 0.45 * wobble(i, 3));
      return { id: it.id, x: Math.max(a.x0, Math.min(a.x1 - w, x)), y, w, h, rot: wobble(i, 4) * 0.1 };
    });
    return { boxes: freeCuts(boxes, byId, cuts, a.gap), decor: null, cuts };
  }
  // The timeline: each picture at its moment, above and below the line in turn, pushed right where it would overlap.
  const mid = (a.y0 + a.y1) / 2;
  const h = (a.y1 - a.y0) * 0.38;
  const lanes = [a.x0, a.x0];
  const boxes = items.map((it, i) => {
    const lane = i % 2;
    const w = h * Math.min(1.4, aspect(it));
    const want = a.x0 + it.when * (a.x1 - a.x0 - w);
    const x = Math.min(a.x1 - w, Math.max(want, lanes[lane]));
    lanes[lane] = x + w + a.gap;
    return { id: it.id, x, y: lane === 0 ? mid - a.gap * 1.5 - h : mid + a.gap * 1.5, w, h, rot: 0 };
  });
  return { boxes: freeCuts(boxes, byId, cuts, a.gap), decor: { kind: 'timeline', y: mid, x0: a.x0 - a.gap * 2 }, cuts };
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
