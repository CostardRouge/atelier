/**
 * Several pictures in one frame — the pure geometry. No DOM, no canvas.
 *
 * A frame is cut into CELLS by a template of one of three kinds:
 *
 * - `tracks`: a grid of weighted columns and rows with CSS-grid-style `areas`
 *   (`'a a b / a a c / d d c'`), which is what a plain grid, a stack and a
 *   bento all are — one solver, three shelves in the picker;
 * - `inset`: one full-frame cell with framed cells laid over its corners;
 * - `free`: prints scattered on the frame, each with its own tilt, that the
 *   author may drag (`CellPlace`).
 *
 * Spacing is given in fractions of the frame's SHORTER side, the rule
 * `sizeFrac` already follows for text: the 720 px stage and the 2160 px export
 * resolve to the same cells, so a crop made on one holds on the other. A
 * template's letter order IS its cell order, and the letters are the only
 * thing that decide which picture lands where: a non-rectangular area is
 * refused rather than guessed, because a guess would move a picture the author
 * had placed.
 *
 * Consumers: the painter (`cell-paint.ts`) draws each picture through its own
 * `Framing` inside the cell it is given; the stage hit-tests the same rects.
 */

import type { Corner, Rect } from './compose-layout';

/** Gap, padding and corner radius, all as fractions of the shorter side. */
export interface LayoutSpacing {
  gap: number;
  padding: number;
  radius: number;
}

export const DEFAULT_LAYOUT_SPACING: LayoutSpacing = { gap: 0.012, padding: 0.016, radius: 0.016 };

const SPACING_MAX: LayoutSpacing = { gap: 0.1, padding: 0.2, radius: 0.2 };

/** A framed cell laid over the full one — `width` a fraction of the short side. */
export interface InsetSpec {
  corner: Corner;
  width: number;
  /** Width over height of the inset itself. */
  aspect: number;
}

/**
 * A print scattered on the frame: its centre as fractions of the frame's own
 * width and height, its width as a fraction of the short side, its tilt in
 * degrees clockwise.
 */
export interface PrintSpec {
  cx: number;
  cy: number;
  width: number;
  aspect: number;
  rotation: number;
}

export type LayoutTemplate =
  | { kind: 'tracks'; cols: readonly number[]; rows: readonly number[]; areas: string }
  | { kind: 'inset'; insets: readonly InsetSpec[] }
  | { kind: 'free'; prints: readonly PrintSpec[] };

/**
 * Where the author moved a print from its template place — offsets as
 * fractions of the frame's width and height, an extra tilt in degrees. Only a
 * `free` template reads it; on any other it is carried and ignored.
 */
export interface CellPlace {
  dx: number;
  dy: number;
  rotation: number;
}

export const DEFAULT_CELL_PLACE: CellPlace = { dx: 0, dy: 0, rotation: 0 };

/** How far a print may be dragged from its template place, in frame fractions. */
export const MAX_PLACE_OFFSET = 0.4;
export const MAX_PLACE_TILT = 30;

/** What the painter wraps around a cell's picture. */
export type CellMount = 'none' | 'print' | 'stroke';

/** One resolved cell, in the pixels of the frame it was resolved for. */
export interface CellRect extends Rect {
  /** Degrees clockwise about the cell's centre. Only prints ever turn. */
  rotation: number;
  mount: CellMount;
}

/** One named area of a `tracks` template, in track indices, both ends inclusive. */
export interface AreaBox {
  id: string;
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/**
 * Parse `'a a b / a a c / d d c'` into boxes, in the order the letters first
 * appear — reading order, which is the cell order. A `.` is an empty track
 * cell. Returns null for ragged rows, an empty string, or a letter whose
 * cells do not form one rectangle: a layout that cannot be drawn as written
 * is refused, never repaired.
 */
export function parseAreas(areas: string): AreaBox[] | null {
  const rows = areas
    .split('/')
    .map((row) => row.trim().split(/\s+/).filter(Boolean));
  if (rows.length === 0 || rows[0].length === 0) return null;
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width)) return null;

  const boxes = new Map<string, AreaBox & { count: number }>();
  const order: (AreaBox & { count: number })[] = [];
  rows.forEach((row, r) =>
    row.forEach((id, c) => {
      if (id === '.') return;
      let box = boxes.get(id);
      if (!box) {
        box = { id, r0: r, r1: r, c0: c, c1: c, count: 0 };
        boxes.set(id, box);
        order.push(box);
      }
      box.r0 = Math.min(box.r0, r);
      box.r1 = Math.max(box.r1, r);
      box.c0 = Math.min(box.c0, c);
      box.c1 = Math.max(box.c1, c);
      box.count += 1;
    }),
  );
  if (order.length === 0) return null;
  for (const box of order) {
    if (box.count !== (box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1)) return null;
  }
  return order.map(({ id, r0, r1, c0, c1 }) => ({ id, r0, r1, c0, c1 }));
}

/** How many cells a template resolves to. 0 for a `tracks` template that does not parse. */
export function cellCount(template: LayoutTemplate): number {
  switch (template.kind) {
    case 'tracks':
      return parseAreas(template.areas)?.length ?? 0;
    case 'inset':
      return 1 + template.insets.length;
    case 'free':
      return template.prints.length;
  }
}

/** Track starts and ends along one axis, weights shared out over what gap and padding leave. */
function tracks(
  weights: readonly number[],
  length: number,
  pad: number,
  gap: number,
): { starts: number[]; ends: number[] } {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const available = Math.max(0, length - 2 * pad - gap * (weights.length - 1));
  const starts: number[] = [];
  const ends: number[] = [];
  let at = pad;
  for (const w of weights) {
    const size = (available * Math.max(0, w)) / total;
    starts.push(at);
    ends.push(at + size);
    at += size + gap;
  }
  return { starts, ends };
}

/**
 * The cells of `template` in a `frameW`×`frameH` frame. Spacing and sizes are
 * fractions, so the result scales exactly with the frame. A `places` entry
 * moves the print at that index (free templates only); an index the template
 * does not have is ignored, so a list kept from a bigger layout is harmless.
 */
export function resolveLayout(
  template: LayoutTemplate,
  frameW: number,
  frameH: number,
  spacing: LayoutSpacing = DEFAULT_LAYOUT_SPACING,
  places?: readonly (CellPlace | null | undefined)[],
): CellRect[] {
  const short = Math.min(frameW, frameH);
  const gap = spacing.gap * short;
  const pad = spacing.padding * short;

  if (template.kind === 'tracks') {
    const boxes = parseAreas(template.areas);
    if (!boxes) return [];
    const cols = tracks(template.cols, frameW, pad, gap);
    const rows = tracks(template.rows, frameH, pad, gap);
    return boxes.map((b) => {
      const c1 = Math.min(b.c1, cols.ends.length - 1);
      const r1 = Math.min(b.r1, rows.ends.length - 1);
      const x = cols.starts[Math.min(b.c0, c1)] ?? 0;
      const y = rows.starts[Math.min(b.r0, r1)] ?? 0;
      return {
        x,
        y,
        w: Math.max(0, (cols.ends[c1] ?? x) - x),
        h: Math.max(0, (rows.ends[r1] ?? y) - y),
        rotation: 0,
        mount: 'none',
      };
    });
  }

  if (template.kind === 'inset') {
    const cells: CellRect[] = [
      { x: pad, y: pad, w: frameW - 2 * pad, h: frameH - 2 * pad, rotation: 0, mount: 'none' },
    ];
    // An inset keeps clear of the edge by at least a little more than the gap,
    // or it reads as a cell of the grid rather than a picture laid over one.
    const margin = pad + Math.max(gap, short * 0.035);
    for (const inset of template.insets) {
      const w = inset.width * short;
      const h = w / (inset.aspect > 0 ? inset.aspect : 1);
      cells.push({
        x: inset.corner === 'tl' || inset.corner === 'bl' ? margin : frameW - margin - w,
        y: inset.corner === 'tl' || inset.corner === 'tr' ? margin : frameH - margin - h,
        w,
        h,
        rotation: 0,
        mount: 'stroke',
      });
    }
    return cells;
  }

  return template.prints.map((p, i) => {
    let w = p.width * short;
    let h = w / (p.aspect > 0 ? p.aspect : 1);
    // A print never takes more than a third of the frame's height, whatever
    // its shape: a pile is several pictures, or it is not a pile.
    const cap = 0.36 * frameH;
    if (h > cap) {
      w *= cap / h;
      h = cap;
    }
    const place = normaliseCellPlace(places?.[i]);
    return {
      x: p.cx * frameW + place.dx * frameW - w / 2,
      y: p.cy * frameH + place.dy * frameH - h / 2,
      w,
      h,
      rotation: p.rotation + place.rotation,
      mount: 'print',
    };
  });
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Read a spacing out of anything — a stored document, an imported file, undefined. */
export function normaliseSpacing(v: unknown): LayoutSpacing {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<LayoutSpacing>;
  return {
    gap: clamp(num(s.gap, DEFAULT_LAYOUT_SPACING.gap), 0, SPACING_MAX.gap),
    padding: clamp(num(s.padding, DEFAULT_LAYOUT_SPACING.padding), 0, SPACING_MAX.padding),
    radius: clamp(num(s.radius, DEFAULT_LAYOUT_SPACING.radius), 0, SPACING_MAX.radius),
  };
}

/** Read a print's place out of anything; a missing one is the template's own. */
export function normaliseCellPlace(v: unknown): CellPlace {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<CellPlace>;
  return {
    dx: clamp(num(p.dx, 0), -MAX_PLACE_OFFSET, MAX_PLACE_OFFSET),
    dy: clamp(num(p.dy, 0), -MAX_PLACE_OFFSET, MAX_PLACE_OFFSET),
    rotation: clamp(num(p.rotation, 0), -MAX_PLACE_TILT, MAX_PLACE_TILT),
  };
}

/**
 * Which cell a point (frame pixels) lands in — the LAST drawn wins, since a
 * later print lies over an earlier one. -1 for none.
 */
export function cellAt(cells: readonly CellRect[], x: number, y: number): number {
  for (let i = cells.length - 1; i >= 0; i--) {
    const c = cells[i];
    const a = (-c.rotation * Math.PI) / 180;
    const dx = x - (c.x + c.w / 2);
    const dy = y - (c.y + c.h / 2);
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= c.w / 2 && Math.abs(ly) <= c.h / 2) return i;
  }
  return -1;
}
