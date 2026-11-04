/**
 * Where everything of a recap sits on its page(s): the heading, the weekday
 * headers, each slot's cell, the call to action. In the page's own pixels
 * (1080 wide, the format's height), so the stage draws a scaled copy and the
 * export draws it at size — one layout, never two that drift.
 *
 * A template IS a layout of slots; the painter (`recap-paint.ts`) only draws
 * what this says, and the editor hit-tests the same boxes to know what a
 * click is about.
 *
 * Pure and DOM-free.
 */

import { monthLead, weekdayHeaders } from './recap-days';
import { FORMATS, MAX_SLIDES, type RecapDoc } from './recap-doc';
import { fillText, type ResolvedRecap } from './recap-slots';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextRole = 'heading' | 'subheading' | 'header' | 'cta';

export interface TextPart {
  kind: 'text';
  role: TextRole;
  id: string;
  box: Box;
  text: string;
  /** Pixels. */
  size: number;
  align: 'left' | 'center' | 'right';
  /** `display` follows the recap's font; `mono` is the numerals' face. */
  face: 'display' | 'mono';
  /** Letter spacing in ems — the trend's spaced capitals. */
  tracking: number;
  upper: boolean;
}

export interface CellPart {
  kind: 'cell';
  /** The slot it shows. */
  id: string;
  box: Box;
  /** Its place in the drawn grid — what an order (a wave, columns) reads. */
  col: number;
  row: number;
  index: number;
  /** The number the cell may print: the day of the month, or the picture's. */
  number: string;
  /** A side label: a rung's "1 year ago", a week's weekday. */
  label?: string;
  /** Where its words go: over the picture, or in a column beside it (on this day). */
  words: 'inside' | 'beside' | 'bottom';
  /** The anchor day — ringed when `cells.today`. */
  today?: boolean;
}

export type Part = TextPart | CellPart;

export interface RecapPage {
  width: number;
  height: number;
  parts: Part[];
  /** True on a page whose pictures cover the page (a week's bands, a single picture). */
  bleed: boolean;
}

export interface RecapLayout {
  pages: RecapPage[];
}

const DISPLAY_SIZE = { sans: 0.062, serif: 0.1, mono: 0.052 };

/** Room a format keeps free at its top and bottom: a Reel's buttons and captions sit over its frame. */
function insets(format: RecapDoc['format'], H: number): { top: number; bottom: number } {
  if (format === 'story') return { top: Math.round(H * 0.12), bottom: Math.round(H * 0.16) };
  return { top: Math.round(H * 0.075), bottom: Math.round(H * 0.06) };
}

function headingParts(doc: RecapDoc, resolved: ResolvedRecap, W: number, top: number, align: 'left' | 'center', x: number, w: number): { parts: TextPart[]; bottom: number } {
  const parts: TextPart[] = [];
  const size = Math.round(W * DISPLAY_SIZE[doc.font]);
  const dx = doc.headingOffset.x * W;
  const dy = doc.headingOffset.y * W;
  let y = top;
  if (doc.heading.show) {
    const text = fillText(doc.heading.text, resolved.vars);
    parts.push({
      kind: 'text',
      role: 'heading',
      id: 'heading',
      box: { x: x + dx, y: y + dy, w, h: Math.round(size * 1.15) },
      text,
      size,
      align,
      face: 'display',
      tracking: doc.font === 'sans' ? 0.06 : 0,
      upper: doc.font === 'sans',
    });
    y += Math.round(size * 1.15) + Math.round(W * 0.012);
  }
  if (doc.subheading.show && doc.subheading.text.trim()) {
    const sub = Math.round(W * 0.024);
    parts.push({
      kind: 'text',
      role: 'subheading',
      id: 'subheading',
      box: { x: x + dx, y: y + dy, w, h: Math.round(sub * 1.4) },
      text: fillText(doc.subheading.text, resolved.vars),
      size: sub,
      align,
      face: 'mono',
      tracking: 0.04,
      upper: true,
    });
    y += Math.round(sub * 1.4);
  }
  return { parts, bottom: y };
}

function ctaPart(doc: RecapDoc, resolved: ResolvedRecap, W: number, y: number): TextPart | null {
  if (!doc.cta.show || !doc.cta.text.trim()) return null;
  const size = Math.round(W * 0.026);
  const w = Math.round(W * 0.62);
  return {
    kind: 'text',
    role: 'cta',
    id: 'cta',
    box: { x: Math.round((W - w) / 2), y, w, h: Math.round(size * 2.6) },
    text: fillText(doc.cta.text, resolved.vars),
    size,
    align: 'center',
    face: 'display',
    tracking: 0,
    upper: false,
  };
}

function monthPage(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number, today: string | null): RecapPage {
  const { top, bottom } = insets(doc.format, H);
  const m = Math.round(W * 0.06);
  const head = headingParts(doc, resolved, W, top, 'center', m, W - 2 * m);
  const parts: Part[] = [...head.parts];
  let y = head.bottom + Math.round(W * 0.035);
  const gap = Math.round(doc.cells.gap * W);
  const colW = (W - 2 * m - 6 * gap) / 7;
  if (doc.cells.headers) {
    const size = Math.round(W * 0.017);
    weekdayHeaders(doc.cells.weekStart).forEach((name, i) => {
      parts.push({
        kind: 'text',
        role: 'header',
        id: `header:${i}`,
        box: { x: m + i * (colW + gap), y, w: colW, h: Math.round(size * 1.6) },
        text: name,
        size,
        align: 'center',
        face: 'display',
        tracking: 0.08,
        upper: true,
      });
    });
    y += Math.round(size * 1.6) + Math.round(W * 0.01);
  }
  const lead = monthLead(doc.anchor, doc.cells.weekStart);
  const n = resolved.slots.length;
  const rows = Math.ceil((lead + n) / 7);
  const rowGap = Math.max(gap, Math.round(W * 0.01));
  const room = H - bottom - y - (doc.cta.show ? Math.round(W * 0.1) : 0);
  const cellH = Math.max(20, Math.min(colW * 0.86, (room - (rows - 1) * rowGap) / rows));
  resolved.slots.forEach((s, i) => {
    const at = lead + i;
    const col = at % 7;
    const row = Math.floor(at / 7);
    parts.push({
      kind: 'cell',
      id: s.id,
      box: { x: m + col * (colW + gap), y: y + row * (cellH + rowGap), w: colW, h: cellH },
      col,
      row,
      index: i,
      number: String(i + 1),
      words: 'inside',
      today: doc.cells.today && s.day === today,
    });
  });
  const gridBottom = y + rows * cellH + (rows - 1) * rowGap;
  const cta = ctaPart(doc, resolved, W, Math.round(gridBottom + W * 0.05));
  if (cta) parts.push(cta);
  return { width: W, height: H, parts, bleed: false };
}

function weekPage(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number, today: string | null): RecapPage {
  const { top } = insets(doc.format, H);
  const gap = Math.round(doc.cells.gap * W);
  const bandW = (W - 6 * gap) / 7;
  const parts: Part[] = resolved.slots.map((s, i) => ({
    kind: 'cell' as const,
    id: s.id,
    box: { x: i * (bandW + gap), y: 0, w: bandW, h: H },
    col: i,
    row: 0,
    index: i,
    number: s.day ? String(Number(s.day.slice(8, 10))) : String(i + 1),
    label: weekdayHeaders(doc.cells.weekStart)[i]?.slice(0, 3),
    words: 'bottom' as const,
    today: doc.cells.today && s.day === today,
  }));
  const m = Math.round(W * 0.06);
  parts.push(...headingParts(doc, resolved, W, top, 'left', m, W - 2 * m).parts);
  const cta = ctaPart(doc, resolved, W, Math.round(H * 0.66));
  if (cta) parts.push(cta);
  return { width: W, height: H, parts, bleed: true };
}

function ladderPage(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number): RecapPage {
  const { top, bottom } = insets(doc.format, H);
  const m = Math.round(W * 0.065);
  const head = headingParts(doc, resolved, W, top, 'left', m, W - 2 * m);
  const parts: Part[] = [...head.parts];
  const y0 = head.bottom + Math.round(W * 0.045);
  const n = Math.max(1, resolved.slots.length);
  const gap = Math.round(W * 0.03);
  const ctaRoom = doc.cta.show ? Math.round(W * 0.09) : 0;
  const rowH = Math.max(40, (H - bottom - ctaRoom - y0 - (n - 1) * gap) / n);
  const labelW = Math.round(W * 0.27);
  resolved.slots.forEach((s, i) => {
    parts.push({
      kind: 'cell',
      id: s.id,
      box: { x: m + labelW, y: y0 + i * (rowH + gap), w: W - 2 * m - labelW, h: rowH },
      col: 0,
      row: i,
      index: i,
      number: String(i + 1),
      label: s.label,
      words: 'beside',
      today: s.day === doc.anchor && doc.cells.today,
    });
  });
  const cta = ctaPart(doc, resolved, W, Math.round(y0 + n * (rowH + gap)));
  if (cta) parts.push(cta);
  return { width: W, height: H, parts, bleed: false };
}

/** A grid shape's places, in columns × rows units: `[col, row, colSpan, rowSpan]`. */
const SHAPES: Record<RecapDoc['grid'], { cols: number; rows: number; cells: [number, number, number, number][] }> = {
  '2x2': { cols: 2, rows: 2, cells: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]] },
  '3x3': { cols: 3, rows: 3, cells: Array.from({ length: 9 }, (_, i) => [i % 3, Math.floor(i / 3), 1, 1] as [number, number, number, number]) },
  bento: {
    cols: 3,
    rows: 4,
    cells: [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1], [0, 2, 1, 1], [1, 2, 1, 2], [2, 2, 1, 1], [0, 3, 1, 1], [2, 3, 1, 1]],
  },
  hero: { cols: 2, rows: 2, cells: [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1]] },
};

function gridCells(shape: (typeof SHAPES)[keyof typeof SHAPES], area: Box, gap: number, ids: readonly string[], numberFrom = 0): CellPart[] {
  const cw = (area.w - (shape.cols - 1) * gap) / shape.cols;
  const ch = (area.h - (shape.rows - 1) * gap) / shape.rows;
  return shape.cells.slice(0, ids.length).map(([c, r, cs, rs], i) => ({
    kind: 'cell' as const,
    id: ids[i],
    box: { x: area.x + c * (cw + gap), y: area.y + r * (ch + gap), w: cs * cw + (cs - 1) * gap, h: rs * ch + (rs - 1) * gap },
    col: c,
    row: r,
    index: numberFrom + i,
    number: String(numberFrom + i + 1),
    words: 'inside' as const,
  }));
}

function gridPage(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number): RecapPage {
  const { top, bottom } = insets(doc.format, H);
  const m = Math.round(W * 0.05);
  const head = headingParts(doc, resolved, W, top, 'left', m, W - 2 * m);
  const y = head.parts.length ? head.bottom + Math.round(W * 0.035) : top;
  const ctaRoom = doc.cta.show ? Math.round(W * 0.09) : 0;
  const area = { x: m, y, w: W - 2 * m, h: H - bottom - ctaRoom - y };
  const gap = Math.round(doc.cells.gap * W);
  const parts: Part[] = [...gridCells(SHAPES[doc.grid], area, gap, resolved.slots.map((s) => s.id)), ...head.parts];
  const cta = ctaPart(doc, resolved, W, Math.round(area.y + area.h + W * 0.02));
  if (cta) parts.push(cta);
  return { width: W, height: H, parts, bleed: false };
}

function singlePage(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number): RecapPage {
  const { bottom } = insets(doc.format, H);
  const parts: Part[] = resolved.slots.slice(0, 1).map((s) => ({
    kind: 'cell' as const,
    id: s.id,
    box: { x: 0, y: 0, w: W, h: H },
    col: 0,
    row: 0,
    index: 0,
    number: '1',
    words: 'bottom' as const,
  }));
  const m = Math.round(W * 0.065);
  // The words sit low, over the picture's own shadow — the painter darkens under them.
  const size = Math.round(W * DISPLAY_SIZE[doc.font]);
  const textTop = H - bottom - Math.round(W * 0.13) - Math.round(size * 1.15) - (doc.subheading.show ? Math.round(W * 0.034) : 0);
  parts.push(...headingParts(doc, resolved, W, textTop, 'left', m, W - 2 * m).parts);
  const cta = ctaPart(doc, resolved, W, Math.round(H * 0.08));
  if (cta) parts.push(cta);
  return { width: W, height: H, parts, bleed: true };
}

/** A dump page's arrangement and how many pictures it holds. */
export type DumpPattern = 'cover' | 'oneTwo' | 'full' | 'four' | 'two' | 'three';
const PATTERN_COUNT: Record<DumpPattern, number> = { cover: 1, oneTwo: 3, full: 1, four: 4, two: 2, three: 3 };
const RHYTHM: readonly DumpPattern[] = ['oneTwo', 'full', 'four', 'two', 'three'];
const FIT: Record<number, DumpPattern> = { 1: 'full', 2: 'two', 3: 'oneTwo', 4: 'four' };

/**
 * The editorial rhythm of a dump: a cover, then densities that change page to
 * page (`docs/recap.md`, «The Sheets»), the last page fitted to what is left,
 * never past an Instagram carousel's twenty slides.
 */
export function dumpPages(count: number): DumpPattern[] {
  const out: DumpPattern[] = [];
  if (count <= 0) return ['cover'];
  out.push('cover');
  let left = count - 1;
  let k = 0;
  while (left > 0 && out.length < MAX_SLIDES) {
    // Four or fewer left end on ONE page fitted to them, never a lone picture after a pair.
    const p = left <= 4 ? FIT[left] : RHYTHM[k % RHYTHM.length];
    out.push(p);
    left -= PATTERN_COUNT[p];
    k++;
  }
  return out;
}

function dumpLayout(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number): RecapPage[] {
  const ids = resolved.slots.map((s) => s.id);
  const m = Math.round(W * 0.06);
  const gap = Math.round(doc.cells.gap * W);
  const pages: RecapPage[] = [];
  let at = 0;
  for (const pattern of dumpPages(ids.length)) {
    const take = ids.slice(at, at + PATTERN_COUNT[pattern]);
    const area = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    let parts: Part[];
    if (pattern === 'cover') {
      const { top, bottom } = insets(doc.format, H);
      const head = headingParts(doc, resolved, W, Math.min(top, Math.round(H * 0.08)), 'left', m, W - 2 * m);
      const y = head.bottom + Math.round(W * 0.04);
      const ctaRoom = doc.cta.show ? Math.round(W * 0.1) : 0;
      parts = [...head.parts, ...gridCells({ cols: 1, rows: 1, cells: [[0, 0, 1, 1]] }, { x: m, y, w: W - 2 * m, h: H - Math.min(bottom, m) - ctaRoom - y }, gap, take, at)];
      const cta = ctaPart(doc, resolved, W, H - Math.min(bottom, m) - ctaRoom + Math.round(W * 0.025));
      if (cta) parts.push(cta);
    } else if (pattern === 'full') {
      parts = gridCells({ cols: 1, rows: 1, cells: [[0, 0, 1, 1]] }, { x: 0, y: 0, w: W, h: H }, 0, take, at);
    } else if (pattern === 'oneTwo') {
      parts = gridCells({ cols: 5, rows: 2, cells: [[0, 0, 3, 2], [3, 0, 2, 1], [3, 1, 2, 1]] }, area, gap, take, at);
    } else if (pattern === 'four') {
      parts = gridCells(SHAPES['2x2'], area, gap, take, at);
    } else if (pattern === 'two') {
      parts = gridCells({ cols: 1, rows: 2, cells: [[0, 0, 1, 1], [0, 1, 1, 1]] }, area, gap, take, at);
    } else {
      parts = gridCells({ cols: 3, rows: 1, cells: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1]] }, area, gap, take, at);
    }
    pages.push({ width: W, height: H, parts, bleed: pattern === 'full' });
    at += take.length;
  }
  return pages;
}

/**
 * The recap's pages. `today` is the real calendar day (the person's wall):
 * a month or a week in progress rings it; on this day rings its anchor.
 */
export function layoutRecap(doc: RecapDoc, resolved: ResolvedRecap, today: string | null = null): RecapLayout {
  const { width: W, height: H } = FORMATS[doc.format];
  switch (doc.template) {
    case 'month':
      return { pages: [monthPage(doc, resolved, W, H, today)] };
    case 'week':
      return { pages: [weekPage(doc, resolved, W, H, today)] };
    case 'onThisDay':
      return { pages: [ladderPage(doc, resolved, W, H)] };
    case 'grid':
      return { pages: [gridPage(doc, resolved, W, H)] };
    case 'single':
      return { pages: [singlePage(doc, resolved, W, H)] };
    case 'dump':
      return { pages: dumpLayout(doc, resolved, W, H) };
  }
}

/** What a point of a page is about: a text's role, a cell's slot, or the background. */
export type Hit = { kind: 'text'; role: TextRole; id: string } | { kind: 'cell'; id: string } | { kind: 'background' };

const inside = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/** Text first — it sits over the pictures — then the cells, else the background. */
export function hitTest(page: RecapPage, x: number, y: number): Hit {
  for (let i = page.parts.length - 1; i >= 0; i--) {
    const p = page.parts[i];
    if (p.kind === 'text' && p.role !== 'header' && inside(p.box, x, y)) return { kind: 'text', role: p.role, id: p.id };
  }
  for (let i = page.parts.length - 1; i >= 0; i--) {
    const p = page.parts[i];
    if (p.kind === 'cell' && inside(p.box, x, y)) return { kind: 'cell', id: p.id };
  }
  return { kind: 'background' };
}

/** The page a slot is drawn on (a dump spreads its slots over pages); 0 when it is on none. */
export function pageOfSlot(layout: RecapLayout, slot: string): number {
  const i = layout.pages.findIndex((p) => p.parts.some((q) => q.kind === 'cell' && q.id === slot));
  return Math.max(0, i);
}

/**
 * Which carousel slide each clip plays on when `clipSlides` is on: the
 * recap's own pages first, then one slide per clip in the order they appear —
 * what a cell's `▶ 4` says, recounted whenever a clip moves.
 */
export function clipSlideNumbers(doc: RecapDoc, resolved: ResolvedRecap, layout: RecapLayout): Map<string, number> {
  const out = new Map<string, number>();
  if (!doc.clipSlides) return out;
  let next = layout.pages.length + 1;
  for (const s of resolved.slots) {
    if (s.picture?.kind !== 'video') continue;
    if (next > MAX_SLIDES) break;
    out.set(s.id, next++);
  }
  return out;
}
