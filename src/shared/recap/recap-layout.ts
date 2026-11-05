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

import { isoWeek, monthLead, shortDate, weekdayHeaders } from './recap-days';
import { FORMATS, MAX_SLIDES, type RecapDoc } from './recap-doc';
import { fillText, ownSlots, rankPictures, type RecapSlot, type ResolvedRecap } from './recap-slots';
import { SLIDE_LAYOUT_COUNT, type SlideLayout } from './recap-carousel';
import { arrangeSheet, sheetSlides, type SheetArea, type SheetDecorItem, type SheetItem } from './recap-sheet';
import { textStyleOf } from './recap-text';
/** «12 Oct» — a day as the film's edge print and the timeline write it. */
const shortDay = (day: string) => shortDate(day).replace(/\s\d{4}$/, '');

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** `running`: the first slide's title repeated small at the top of the others, with the slide's number; `quote`: a sheet's breather line. */
export type TextRole = 'heading' | 'subheading' | 'header' | 'cta' | 'running' | 'quote';

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
  /** Radians: a sheet's collage print, turned. */
  rot?: number;
  /** Drawn as a print, its border round it — white (a deep foot) or thin (a sheet's collage). */
  print?: 'white' | 'thin';
  /** The anchor day — ringed when `cells.today`. */
  today?: boolean;
}

export type Part = TextPart | CellPart;

export interface RecapPage {
  /** What the carousel's order names it by: `first`, a flow slide `p:3`, a week `w:1` (`recap-carousel.ts`). */
  key: string;
  width: number;
  height: number;
  parts: Part[];
  /** True on a page whose pictures cover the page (a week's bands, a single picture). */
  bleed: boolean;
  /** A slice of the Sheets: what it draws behind its pictures, in the page's own pixels (`recap-sheet.ts`). */
  sheet?: { index: number; decor: SheetDecorItem[] };
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
  const size = Math.round(W * DISPLAY_SIZE[doc.font] * textStyleOf(doc.texts, 'heading').size);
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
    const sub = Math.round(W * 0.024 * textStyleOf(doc.texts, 'subheading').size);
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
  const size = Math.round(W * 0.026 * textStyleOf(doc.texts, 'cta').size);
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
    const size = Math.round(W * 0.017 * textStyleOf(doc.texts, 'weekdays').size);
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
  const n = ownSlots(resolved).length;
  const rows = Math.ceil((lead + n) / 7);
  const rowGap = Math.max(gap, Math.round(W * 0.01));
  const room = H - bottom - y - (doc.cta.show ? Math.round(W * 0.1) : 0);
  const cellH = Math.max(20, Math.min(colW * 0.86, (room - (rows - 1) * rowGap) / rows));
  ownSlots(resolved).forEach((s, i) => {
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
  // The block — heading to the last row — sits at the page's OPTICAL centre, a little above the middle of the room
  // the format leaves free, rather than hanging from the top with half the page empty under it.
  const blockBottom = cta ? cta.box.y + cta.box.h : gridBottom;
  const spare = H - bottom - blockBottom;
  if (spare > 0) {
    const shift = Math.round(spare * 0.42);
    for (const p of parts) p.box = { ...p.box, y: p.box.y + shift };
  }
  return { key: 'first', width: W, height: H, parts, bleed: false };
}

function weekPage(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number, today: string | null): RecapPage {
  const { top } = insets(doc.format, H);
  const gap = Math.round(doc.cells.gap * W);
  const bandW = (W - 6 * gap) / 7;
  const parts: Part[] = ownSlots(resolved).map((s, i) => ({
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
  return { key: 'first', width: W, height: H, parts, bleed: true };
}

function ladderPage(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number): RecapPage {
  const { top, bottom } = insets(doc.format, H);
  const m = Math.round(W * 0.065);
  const head = headingParts(doc, resolved, W, top, 'left', m, W - 2 * m);
  const parts: Part[] = [...head.parts];
  const y0 = head.bottom + Math.round(W * 0.045);
  const n = Math.max(1, ownSlots(resolved).length);
  const gap = Math.round(W * 0.03);
  const ctaRoom = doc.cta.show ? Math.round(W * 0.09) : 0;
  const rowH = Math.max(40, (H - bottom - ctaRoom - y0 - (n - 1) * gap) / n);
  const labelW = Math.round(W * 0.27);
  ownSlots(resolved).forEach((s, i) => {
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
  return { key: 'first', width: W, height: H, parts, bleed: false };
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
  const parts: Part[] = [...gridCells(SHAPES[doc.grid], area, gap, ownSlots(resolved).map((s) => s.id)), ...head.parts];
  const cta = ctaPart(doc, resolved, W, Math.round(area.y + area.h + W * 0.02));
  if (cta) parts.push(cta);
  return { key: 'first', width: W, height: H, parts, bleed: false };
}

function singlePage(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number): RecapPage {
  const { bottom } = insets(doc.format, H);
  const parts: Part[] = ownSlots(resolved).slice(0, 1).map((s) => ({
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
  return { key: 'first', width: W, height: H, parts, bleed: true };
}

/** A dump page's arrangement and how many pictures it holds. */
export type DumpPattern = 'cover' | SlideLayout;
const RHYTHM: readonly SlideLayout[] = ['oneTwo', 'full', 'four', 'two', 'three'];
const FIT: Record<number, SlideLayout> = { 1: 'full', 2: 'two', 3: 'oneTwo', 4: 'four' };

/**
 * The editorial rhythm of a dump: a cover, then densities that change page to
 * page (`docs/recap.md`, «The Sheets»), the last page fitted to what is left,
 * never past an Instagram carousel's twenty slides.
 */
export function dumpPages(count: number): DumpPattern[] {
  if (count <= 0) return ['cover'];
  return ['cover', ...flowLayouts(count - 1).map((f) => f.layout)];
}

/** The cells of a flow slide's layout, in columns × rows units. */
const FLOW_SHAPES: Record<SlideLayout, (typeof SHAPES)[keyof typeof SHAPES]> = {
  full: { cols: 1, rows: 1, cells: [[0, 0, 1, 1]] },
  two: { cols: 1, rows: 2, cells: [[0, 0, 1, 1], [0, 1, 1, 1]] },
  oneTwo: { cols: 5, rows: 2, cells: [[0, 0, 3, 2], [3, 0, 2, 1], [3, 1, 2, 1]] },
  three: { cols: 3, rows: 1, cells: [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1]] },
  four: SHAPES['2x2'],
  six: { cols: 2, rows: 3, cells: Array.from({ length: 6 }, (_, i) => [i % 2, Math.floor(i / 2), 1, 1] as [number, number, number, number]) },
};

/**
 * The flow slides' layouts for `count` pictures: each its own set by hand
 * (`fixed`, by its place), else the rhythm — the last fitted to what is
 * left — never past `room` slides. A slide set by hand that asks more than
 * is left takes what is left.
 */
export function flowLayouts(count: number, fixed: Readonly<Record<string, SlideLayout>> = {}, room = MAX_SLIDES - 1): { layout: SlideLayout; take: number; auto: boolean }[] {
  const out: { layout: SlideLayout; take: number; auto: boolean }[] = [];
  let left = count;
  let k = 0;
  while (left > 0 && out.length < room) {
    const set = fixed[`p:${k}`];
    const layout: SlideLayout = set ?? (left <= 4 ? FIT[left] : RHYTHM[k % RHYTHM.length]);
    const take = Math.min(SLIDE_LAYOUT_COUNT[layout], left);
    out.push({ layout, take, auto: !set });
    left -= take;
    k++;
  }
  return out;
}

/** The running head's words: the title, and the slide's number once the order is known (`layoutRecap`). */
function runningPart(doc: RecapDoc, resolved: ResolvedRecap, W: number, m: number): TextPart | null {
  if (!doc.heading.show) return null;
  const size = Math.round(W * 0.026 * textStyleOf(doc.texts, 'heading').size);
  return { kind: 'text', role: 'running', id: 'running', box: { x: m, y: Math.round(m * 0.18), w: W - 2 * m, h: Math.round(size * 1.3) }, text: fillText(doc.heading.text, resolved.vars), size, align: 'left', face: 'mono', tracking: 0.08, upper: true };
}

/**
 * The slides after the first, from `ids` in order: each in its layout, the
 * first slide's title repeated as the carousel asks (`titles`).
 */
function flowPages(doc: RecapDoc, resolved: ResolvedRecap, ids: readonly string[], numberFrom: number, W: number, H: number): RecapPage[] {
  const m = Math.round(W * 0.06);
  const gap = Math.round(doc.cells.gap * W);
  const titles = doc.carousel.titles;
  const pages: RecapPage[] = [];
  let at = 0;
  flowLayouts(ids.length, doc.carousel.layouts).forEach(({ layout, take }, k) => {
    const these = ids.slice(at, at + take);
    const full = layout === 'full';
    const parts: Part[] = [];
    let area: Box = full ? { x: 0, y: 0, w: W, h: H } : { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    const heads: Part[] = [];
    if (titles === 'same') {
      const head = headingParts(doc, resolved, W, m, 'left', m, W - 2 * m);
      heads.push(...head.parts);
      // Over a full-page picture the title sits on it; elsewhere the pictures move down under it.
      if (!full && head.parts.length) area = { x: m, y: head.bottom + Math.round(W * 0.03), w: W - 2 * m, h: H - m - (head.bottom + Math.round(W * 0.03)) };
    } else if (titles === 'head') {
      const run = runningPart(doc, resolved, W, m);
      if (run) heads.push(run);
    }
    parts.push(...gridCells(FLOW_SHAPES[layout], area, full ? 0 : gap, these, numberFrom + at), ...heads);
    pages.push({ key: `p:${k}`, width: W, height: H, parts, bleed: full });
    at += take;
  });
  return pages;
}

/** The dump's cover: its title, its first picture, its call to action. */
function coverPage(doc: RecapDoc, resolved: ResolvedRecap, id: string | undefined, W: number, H: number): RecapPage {
  const m = Math.round(W * 0.06);
  const gap = Math.round(doc.cells.gap * W);
  const { top, bottom } = insets(doc.format, H);
  const head = headingParts(doc, resolved, W, Math.min(top, Math.round(H * 0.08)), 'left', m, W - 2 * m);
  const y = head.bottom + Math.round(W * 0.04);
  const ctaRoom = doc.cta.show ? Math.round(W * 0.1) : 0;
  const parts: Part[] = [...head.parts, ...gridCells({ cols: 1, rows: 1, cells: [[0, 0, 1, 1]] }, { x: m, y, w: W - 2 * m, h: H - Math.min(bottom, m) - ctaRoom - y }, gap, id ? [id] : [], 0)];
  const cta = ctaPart(doc, resolved, W, H - Math.min(bottom, m) - ctaRoom + Math.round(W * 0.025));
  if (cta) parts.push(cta);
  return { key: 'first', width: W, height: H, parts, bleed: false };
}

/**
 * A month's slide per week (carousel lab, B): its best day big, its other
 * days in a band under it, a small «Week 44» over it.
 */
function weekPages(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number): RecapPage[] {
  const days = ownSlots(resolved).filter((s) => s.day);
  const weeks: RecapSlot[][] = [];
  for (const s of days) {
    const dow = new Date(`${s.day}T00:00:00Z`).getUTCDay();
    if (!weeks.length || dow === doc.cells.weekStart) weeks.push([]);
    weeks[weeks.length - 1].push(s);
  }
  const m = Math.round(W * 0.06);
  const gap = Math.round(doc.cells.gap * W);
  return weeks
    .filter((w) => w.some((s) => s.picture))
    .slice(0, MAX_SLIDES - 1)
    .map((w, i) => {
      const best = rankPictures(w.flatMap((s) => (s.picture ? [s.picture] : [])))[0];
      const big = w.find((s) => s.picture === best)!;
      const rest = w.filter((s) => s !== big && s.picture).slice(0, 6);
      const label = Math.round(W * 0.03);
      const parts: Part[] = [];
      const titleParts: Part[] = [];
      let top = m + Math.round(label * 1.6);
      if (doc.carousel.titles === 'same') {
        const head = headingParts(doc, resolved, W, m, 'left', m, W - 2 * m);
        titleParts.push(...head.parts);
        top = head.bottom + Math.round(label * 1.6);
      } else if (doc.carousel.titles === 'head') {
        const run = runningPart(doc, resolved, W, m);
        if (run) titleParts.push(run);
      }
      parts.push({ kind: 'text', role: 'header', id: `header:week${i}`, box: { x: m, y: top - Math.round(label * 1.4), w: W - 2 * m, h: Math.round(label * 1.3) }, text: `Week ${isoWeek(w[0].day!)}`, size: label, align: 'left', face: 'mono', tracking: 0.1, upper: true });
      const band = rest.length ? Math.round((W - 2 * m - gap * 5) / 6) : 0;
      const bigBox: Box = { x: m, y: top, w: W - 2 * m, h: H - m - top - (band ? band + gap : 0) };
      parts.push({ kind: 'cell', id: big.id, box: bigBox, col: 0, row: 0, index: 0, number: String(Number(big.day!.slice(-2))), words: 'inside' });
      rest.forEach((s, j) => parts.push({ kind: 'cell', id: s.id, box: { x: m + j * (band + gap), y: bigBox.y + bigBox.h + gap, w: band, h: band }, col: j, row: 1, index: j + 1, number: String(Number(s.day!.slice(-2))), words: 'inside' }));
      parts.push(...titleParts);
      return { key: `w:${i}`, width: W, height: H, parts, bleed: false };
    });
}

/** `items` in the author's order (`carousel.order`), what it does not name after, in their own order. */
function inOrder<T extends { key: string }>(items: readonly T[], order: readonly string[] | null): T[] {
  if (!order) return [...items];
  const byKey = new Map(items.map((x) => [x.key, x]));
  const out = order.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
  const named = new Set(out.map((x) => x.key));
  return [...out, ...items.filter((x) => !named.has(x.key))];
}

/** A slide of the carousel: one of the recap's pages, or a clip playing whole. */
export type CarouselSlide = { key: string; kind: 'page'; page: number } | { key: string; kind: 'clip'; slot: string };

/**
 * The carousel, slide by slide, in the author's order: the pages, then — when
 * `clipSlides` is on — one slide per clip; never past Instagram's twenty.
 * The Reel plays the pages in this same order (`layoutRecap` orders them).
 */
export function carouselSlides(doc: RecapDoc, resolved: ResolvedRecap, layout: RecapLayout): CarouselSlide[] {
  const pages: CarouselSlide[] = layout.pages.map((p, i) => ({ key: p.key, kind: 'page', page: i }));
  const seen = new Set<string>();
  const clips: CarouselSlide[] = doc.clipSlides
    ? resolved.slots.flatMap((s) => {
        if (s.picture?.kind !== 'video' || seen.has(s.picture.key)) return [];
        seen.add(s.picture.key);
        return [{ key: `clip:${s.id}`, kind: 'clip' as const, slot: s.id }];
      })
    : [];
  return (doc.template === 'sheets' ? [...pages, ...clips] : inOrder([...pages, ...clips], doc.carousel.order)).slice(0, MAX_SLIDES);
}

/**
 * The Sheets: the period laid on one sheet `slides` pages wide
 * (`arrangeSheet`), then cut into its slides — a picture across a cut is a
 * cell on both, each showing its half (the painter clips to the page). The
 * cover keeps the first slide's left for the title.
 */
function sheetPages(doc: RecapDoc, resolved: ResolvedRecap, W: number, H: number): RecapPage[] {
  const slots = resolved.slots.filter((s) => s.picture);
  const slides = sheetSlides(slots.length, doc.sheet.slides);
  const { top, bottom } = insets(doc.format, H);
  const m = Math.round(W * 0.06);
  const days = slots.flatMap((s) => (s.picture?.day ? [Date.parse(`${s.picture.day}T00:00:00Z`)] : []));
  const lo = Math.min(...days, Infinity);
  const hi = Math.max(...days, -Infinity);
  const items: SheetItem[] = slots.map((s) => {
    const p = s.picture!;
    const t = p.day ? Date.parse(`${p.day}T00:00:00Z`) + (p.minute ?? 720) * 60000 : lo;
    return {
      id: s.id,
      aspect: p.width && p.height ? p.width / p.height : 1,
      faces: p.faces ?? 0,
      when: hi > lo ? Math.min(1, Math.max(0, (t - lo) / (hi - lo + 86_400_000))) : 0.5,
      score: p.picked ? 5 : (p.stars ?? 0),
      ...(p.day ? { label: shortDay(p.day) } : {}),
    };
  });
  const area: SheetArea = {
    slides,
    W,
    H,
    x0: Math.round(W * 0.58),
    x1: slides * W - m,
    y0: Math.max(top, Math.round(H * 0.09)),
    y1: H - Math.max(bottom, Math.round(H * 0.09)),
    gap: Math.max(4, Math.round(doc.cells.gap * W)),
    rows: doc.format === 'story' ? 3 : 2,
  };
  const laid = arrangeSheet(items, area, doc.sheet);
  const border = doc.sheet.arrangement === 'collage' && doc.sheet.collage.border !== 'none' ? doc.sheet.collage.border : null;
  const heroes = new Set(laid.own.filter((o) => o.layout === 'hero').map((o) => o.index));
  const head = headingParts(doc, resolved, W, Math.round(H * 0.4), 'left', m, Math.round(W * 0.46));
  const cta = ctaPart(doc, resolved, W, H - Math.max(bottom, m) - Math.round(W * 0.06));
  return Array.from({ length: slides }, (_, i) => {
    const left = i * W;
    const cells: Part[] = [];
    laid.boxes.forEach((b, k) => {
      if (b.x >= left + W || b.x + b.w <= left) return;
      // A slide's own layout draws its pictures plain; the arrangement's prints keep their border.
      const own = b.x >= left - 1 && b.x + b.w <= left + W + 1 && laid.own.some((o) => o.index === i);
      cells.push({ kind: 'cell', id: b.id, box: { x: b.x - left, y: b.y, w: b.w, h: b.h }, col: k, row: 0, index: k, number: String(k + 1), words: 'inside', ...(b.rot ? { rot: b.rot } : {}), ...(border && !own ? { print: border } : {}) });
    });
    // The decor in this slide's own pixels: what reaches into it.
    const decor: SheetDecorItem[] = laid.decor.flatMap((d): SheetDecorItem[] => {
      if (d.kind === 'marks') {
        const marks = d.marks.filter((mk) => mk.x > left - W * 0.3 && mk.x < left + W).map((mk) => ({ ...mk, x: mk.x - left }));
        return marks.length ? [{ ...d, marks }] : [];
      }
      if (d.x1 <= left || d.x0 >= left + W) return [];
      return [{ ...d, x0: d.x0 - left, x1: d.x1 - left }];
    });
    const breather = laid.own.find((o) => o.index === i && o.layout === 'breather' && o.text);
    const quote: Part[] = breather
      ? [
          {
            kind: 'text',
            role: 'quote',
            id: `quote:${i}`,
            box: { x: m, y: Math.round(H * 0.44), w: W - 2 * m, h: Math.round(W * DISPLAY_SIZE[doc.font] * 0.75 * 1.2) },
            text: breather.text!,
            // The title's own size, a little under it: a pause in the swipe, read at a glance.
            size: Math.round(W * DISPLAY_SIZE[doc.font] * 0.75 * textStyleOf(doc.texts, 'heading').size),
            align: 'left',
            face: 'display',
            tracking: 0,
            upper: false,
          },
        ]
      : [];
    const parts: Part[] = [...cells, ...quote, ...(i === 0 ? head.parts : []), ...(i === 0 && cta ? [cta] : [])];
    return { key: `s:${i}`, width: W, height: H, parts, bleed: heroes.has(i), sheet: { index: i, decor } };
  });
}

/**
 * The recap's pages. `today` is the real calendar day (the person's wall):
 * a month or a week in progress rings it; on this day rings its anchor.
 */
export function layoutRecap(doc: RecapDoc, resolved: ResolvedRecap, today: string | null = null): RecapLayout {
  const { width: W, height: H } = FORMATS[doc.format];
  let pages: RecapPage[];
  if (doc.template === 'sheets') {
    // One sheet: its slides keep their order, a slice moved elsewhere would break the picture across its cut.
    const sheet = { pages: sheetPages(doc, resolved, W, H) };
    return sheet;
  }
  if (doc.template === 'dump') {
    const ids = resolved.slots.map((s) => s.id);
    pages = [coverPage(doc, resolved, ids[0], W, H), ...flowPages(doc, resolved, ids.slice(1), 1, W, H)];
  } else {
    const first =
      doc.template === 'month'
        ? monthPage(doc, resolved, W, H, today)
        : doc.template === 'week'
          ? weekPage(doc, resolved, W, H, today)
          : doc.template === 'onThisDay'
            ? ladderPage(doc, resolved, W, H)
            : doc.template === 'grid'
              ? gridPage(doc, resolved, W, H)
              : singlePage(doc, resolved, W, H);
    const after =
      doc.carousel.after === 'weeks' && doc.template === 'month'
        ? weekPages(doc, resolved, W, H)
        : flowPages(doc, resolved, resolved.slots.filter((s) => s.flow && s.picture).map((s) => s.id), 0, W, H);
    pages = [first, ...after];
  }
  // The author's order, for the stage, the Reel and the carousel alike; the running heads count in it.
  const ordered = { pages: inOrder(pages, doc.carousel.order) };
  const slides = carouselSlides(doc, resolved, ordered);
  for (const page of ordered.pages) {
    const n = slides.findIndex((s) => s.key === page.key) + 1;
    for (const part of page.parts) if (part.kind === 'text' && part.role === 'running') part.text = `${part.text} · ${n}/${slides.length}`;
  }
  return ordered;
}

/** What a point of a page is about: a text's role, a cell's slot, or the background. */
export type Hit = { kind: 'text'; role: TextRole; id: string } | { kind: 'cell'; id: string } | { kind: 'background' };

const inside = (b: Box, x: number, y: number) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/** Text first — it sits over the pictures — then the cells, else the background. */
export function hitTest(page: RecapPage, x: number, y: number): Hit {
  for (let i = page.parts.length - 1; i >= 0; i--) {
    const p = page.parts[i];
    if (p.kind === 'text' && inside(p.box, x, y)) return { kind: 'text', role: p.role, id: p.id };
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
  carouselSlides(doc, resolved, layout).forEach((s, i) => {
    if (s.kind === 'clip') out.set(s.slot, i + 1);
  });
  return out;
}
