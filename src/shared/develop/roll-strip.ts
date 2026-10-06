/**
 * The geometry of a roll's BAND — the strip of its pictures under (or beside)
 * the one on the stage — and of the contact sheet drawn over it
 * (`docs/develop-roll-browser.md`, face D). Pure and DOM-free: the editor
 * measures its boxes and hands the numbers in, and every cell comes back as a
 * rectangle to draw.
 *
 * Three shapes, one arithmetic:
 *
 *  - **one row** — the band at its smallest: every cell as tall as the body,
 *    at its picture's own aspect, scrolling sideways;
 *  - **rows** — the band pulled up by its grip: a JUSTIFIED grid (every row
 *    filled edge to edge, Flickr's and Lightroom's), its row count read off
 *    the band's height against the thumbnail size the author chose, and the
 *    rows then sharing that height exactly, so the band never rests on half
 *    a row; scrolling down;
 *  - **columns** — the band standing beside the picture: the same justified
 *    rows, the target set so that N landscape pictures sit side by side.
 *
 * The contact sheet is the rows again, at its own thumbnail size, with every
 * caption drawn.
 *
 * A cell's aspect is the THUMBNAIL's (measured once it is decoded), which is
 * the picture as cropped — a square crop is a square cell — and until then
 * the crop's own id says it, else 3:2. Aspects are clamped so one panorama
 * cannot own a whole row.
 *
 * What the author set about the band — where it is, how big, folded or not,
 * the thumbnail sizes — is a preference of the DEVICE, never of the roll
 * (`readStripPrefs`): a phone and a wide screen want different bands of the
 * same roll.
 */

import { ASPECT_PRESETS } from '../projects/project-types';
import type { Culling, CullFilter } from '../sources/winnow/culling';
import { CULL_FILTERS, cullFilterKey, cullFilterLabel, passesCull } from '../sources/winnow/culling';
import { freeAspectRatio } from './crop-aspect';
import { isIgnored, matchesDeliveryFilter, type DeliveryFilter, type RollPicture } from './roll-types';

/** The shell the band is drawn in: the phone's compact one, or anything wider. */
export type StripKind = 'desktop' | 'phone';

/** Where the band sits. A phone always reads `bottom`. */
export type StripPlace = 'bottom' | 'left' | 'right';

/** Whether a cell's name is drawn under it: past a height, always, or never. */
export type CaptionMode = 'auto' | 'always' | 'never';

export interface StripMetrics {
  /** The grip between the stage and the band. */
  grip: number;
  /** The band's header row — the folded band is exactly this. */
  head: number;
  /** Padding inside the body, on every side. */
  pad: number;
  /** Between cells. */
  gap: number;
  /** A caption's height, under a cell that wears one. */
  cap: number;
  /** A cell at least this tall gets its caption (`auto`). */
  capAt: number;
  /** One row's cell height — the band's default size. */
  row: number;
  /** The thumbnail size a grid aims at, and its reach. */
  thumb: number;
  thumbMin: number;
  thumbMax: number;
  thumbStep: number;
  /** The contact sheet's, same shape. */
  sheet: number;
  sheetMin: number;
  sheetMax: number;
  sheetStep: number;
  /** A column folded to its rail, and a column at rest. */
  rail: number;
  column: number;
  /** A column's cells aim at this width across (landscape ones side by side). */
  columnCell: number;
  /** The narrowest column, and the least stage a band may leave. */
  columnMin: number;
  stageMin: number;
}

/**
 * The numbers. The header is the height of the suite's small buttons on a
 * desktop (`h-7`) and of its medium ones on a phone (`h-[2.125rem]`), so the
 * row is exactly one `IconButton` tall. The thumbnail sizes are the lab's
 * (`docs/develop-roll-browser.md`), chosen so that his 1270 × 1300 window
 * takes one row of 100 px under a landscape picture for nothing.
 */
export const STRIP_METRICS: Readonly<Record<StripKind, Readonly<StripMetrics>>> = {
  desktop: {
    grip: 12,
    head: 28,
    pad: 6,
    gap: 6,
    cap: 16,
    capAt: 112,
    row: 100,
    thumb: 120,
    thumbMin: 72,
    thumbMax: 220,
    thumbStep: 16,
    sheet: 176,
    sheetMin: 96,
    sheetMax: 320,
    sheetStep: 24,
    rail: 30,
    column: 188,
    columnCell: 168,
    columnMin: 120,
    stageMin: 150,
  },
  phone: {
    grip: 14,
    head: 34,
    pad: 6,
    gap: 5,
    cap: 15,
    capAt: 92,
    row: 80,
    thumb: 88,
    thumbMin: 60,
    thumbMax: 150,
    thumbStep: 10,
    sheet: 104,
    sheetMin: 70,
    sheetMax: 180,
    sheetStep: 14,
    rail: 30,
    column: 150,
    columnCell: 140,
    columnMin: 100,
    stageMin: 120,
  },
};

/** No cell narrower than a 9:16 frame nor wider than 2:1 — a panorama is a wide cell, never a whole row. */
export const ASPECT_FLOOR = 0.56;
export const ASPECT_CEILING = 2;

export function clampAspect(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1.5;
  return Math.min(ASPECT_CEILING, Math.max(ASPECT_FLOOR, aspect));
}

/**
 * The aspect a cell is laid out at, before and after its thumbnail is known:
 * the measured thumbnail (the picture as cropped and framed) wins; else the
 * crop's own id says the shape (`'4:5'`, `'free:1.37'`); else 3:2, the shape
 * most of his files are shot in.
 */
export function cellAspect(picture: Pick<RollPicture, 'aspect'>, measured?: number): number {
  if (measured !== undefined && Number.isFinite(measured) && measured > 0) return clampAspect(measured);
  const free = freeAspectRatio(picture.aspect);
  if (free !== null) return clampAspect(free);
  const preset = ASPECT_PRESETS.find((p) => p.id === picture.aspect);
  return clampAspect(preset ? preset.w / preset.h : 1.5);
}

export interface StripItem {
  id: string;
  aspect: number;
}

/** What a scroller shows of its layout: the scroll position and the box's size, in layout pixels. */
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The cells a scroller must DRAW: those within ONE view of the visible box
 * on the scroll axis, and the open picture's cell always (it is scrolled to,
 * so it must exist). A roll of hundreds used to put every cell in the DOM at
 * open and re-render all of them for each thumbnail that arrived
 * (`docs/audit-2026-10-02.md`, PERF-03); a band shows a few dozen at once.
 * A view with no size yet (the box unmeasured) draws the open cell alone —
 * one frame, never the whole roll.
 */
export function cellsInView(cells: readonly StripCell[], view: ViewBox, axis: 'x' | 'y', openId: string | null): StripCell[] {
  const start = axis === 'x' ? view.x : view.y;
  const extent = axis === 'x' ? view.w : view.h;
  if (!(extent > 0)) return cells.filter((c) => c.id === openId);
  const from = start - extent;
  const to = start + 2 * extent;
  return cells.filter((c) => {
    if (c.id === openId) return true;
    const a = axis === 'x' ? c.x : c.y;
    const b = axis === 'x' ? c.x + c.w : c.y + c.h + c.cap;
    return b > from && a < to;
  });
}

export interface StripCell {
  id: string;
  x: number;
  y: number;
  /** The PICTURE's box; the caption, when there is one, sits under it. */
  w: number;
  h: number;
  /** The caption's height under the picture, 0 for none. */
  cap: number;
}

export interface StripLayout {
  cells: StripCell[];
  /** The laid-out content's extent — what the scroller holds. */
  width: number;
  height: number;
  /** Which way the body scrolls. */
  axis: 'x' | 'y';
  /** How tall a cell is, for the readout and the caption rule (the target, in a grid). */
  cellHeight: number;
  /** Rows across the body (a scrolling row is 1); columns beside the picture. */
  rows: number;
  columns: number;
}

/** The middle aspect of a roll — what the band's own height is sized against, so it does not move from one picture to the next. */
export function medianAspect(items: readonly StripItem[]): number {
  if (items.length === 0) return 1.5;
  const sorted = items.map((i) => clampAspect(i.aspect)).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Whether a cell this tall wears its caption. */
export function captionFor(cellHeight: number, metrics: Readonly<StripMetrics>, mode: CaptionMode): number {
  if (mode === 'never') return 0;
  if (mode === 'always') return metrics.cap;
  return cellHeight >= metrics.capAt ? metrics.cap : 0;
}

/**
 * Rows filled edge to edge: cells are gathered until, at the target height,
 * they overflow the width, and the row is then scaled to fit exactly. The
 * last row keeps the target (never stretched to fill — three pictures on a
 * wide row would become three posters) and only shrinks if it must.
 */
export function justifyRows(
  items: readonly StripItem[],
  width: number,
  target: number,
  gap: number,
  cap: number,
): { cells: StripCell[]; height: number } {
  const cells: StripCell[] = [];
  if (width <= 0 || target <= 0) return { cells, height: 0 };
  let row: { id: string; a: number }[] = [];
  let sum = 0;
  let y = 0;
  const flush = (last: boolean) => {
    if (row.length === 0) return;
    const gaps = gap * (row.length - 1);
    const fitted = (width - gaps) / sum;
    const h = last ? Math.min(target, fitted) : fitted;
    let x = 0;
    for (const it of row) {
      const w = h * it.a;
      cells.push({ id: it.id, x, y, w, h, cap });
      x += w + gap;
    }
    y += h + cap + gap;
    row = [];
    sum = 0;
  };
  for (const it of items) {
    const a = clampAspect(it.aspect);
    row.push({ id: it.id, a });
    sum += a;
    if (sum * target + gap * (row.length - 1) >= width) flush(false);
  }
  flush(true);
  return { cells, height: Math.max(0, y - gap) };
}

/** One row of cells as tall as `height`, each at its aspect, scrolling sideways. */
export function oneRow(items: readonly StripItem[], height: number, gap: number, cap: number): { cells: StripCell[]; width: number } {
  const cells: StripCell[] = [];
  const h = Math.max(0, height - cap);
  let x = 0;
  for (const it of items) {
    const w = h * clampAspect(it.aspect);
    cells.push({ id: it.id, x, y: 0, w, h, cap });
    x += w + gap;
  }
  return { cells, width: Math.max(0, x - gap) };
}

/** How many rows a band this tall shows, against the thumbnail size the author chose. */
export function rowsForHeight(bodyHeight: number, metrics: Readonly<StripMetrics>, thumb: number, captions: CaptionMode = 'auto'): number {
  const avail = bodyHeight - 2 * metrics.pad;
  const stride = thumb + captionFor(thumb, metrics, captions) + metrics.gap;
  return Math.max(1, Math.round((avail + metrics.gap) / stride));
}

/**
 * The band's height for N rows — the menu's "One row" (the row's own
 * height), "Two rows", "Three rows" (the thumbnail size, captions included
 * where the size earns one).
 */
export function heightForRows(rows: number, metrics: Readonly<StripMetrics>, thumb: number, captions: CaptionMode = 'auto'): number {
  const n = Math.max(1, Math.round(rows));
  if (n === 1) return metrics.head + 2 * metrics.pad + metrics.row;
  const cell = thumb + captionFor(thumb, metrics, captions);
  return metrics.head + 2 * metrics.pad + n * cell + (n - 1) * metrics.gap;
}

/** The band under the picture: a scrolling row at its smallest, a justified grid once pulled up. */
export function bandLayout({
  items,
  width,
  bodyHeight,
  metrics,
  thumb,
  captions = 'auto',
}: {
  items: readonly StripItem[];
  width: number;
  /** The body's height — the band minus its header. */
  bodyHeight: number;
  metrics: Readonly<StripMetrics>;
  thumb: number;
  captions?: CaptionMode;
}): StripLayout {
  const avail = Math.max(0, bodyHeight - 2 * metrics.pad);
  const rows = rowsForHeight(bodyHeight, metrics, thumb, captions);
  if (rows === 1) {
    const cap = captionFor(avail - captionFor(avail, metrics, captions), metrics, captions);
    const row = oneRow(items, avail, metrics.gap, cap);
    return {
      cells: row.cells.map((c) => ({ ...c, x: c.x + metrics.pad, y: c.y + metrics.pad })),
      width: row.width + 2 * metrics.pad,
      height: bodyHeight,
      axis: 'x',
      cellHeight: avail - cap,
      rows: 1,
      columns: 0,
    };
  }
  const cap = captionFor(thumb, metrics, captions);
  const target = Math.max(1, (avail + metrics.gap) / rows - metrics.gap - cap);
  const grid = justifyRows(items, Math.max(0, width - 2 * metrics.pad), target, metrics.gap, cap);
  return {
    cells: grid.cells.map((c) => ({ ...c, x: c.x + metrics.pad, y: c.y + metrics.pad })),
    width,
    height: grid.height + 2 * metrics.pad,
    axis: 'y',
    cellHeight: target,
    rows,
    columns: 0,
  };
}

/** How many columns a band this wide holds beside the picture. */
export function columnsForWidth(width: number, metrics: Readonly<StripMetrics>): number {
  const inner = width - 2 * metrics.pad;
  return Math.max(1, Math.round((inner + metrics.gap) / (metrics.columnCell + metrics.gap)));
}

/** The band's width for N columns — the menu's "One column", "Two columns"… */
export function widthForColumns(columns: number, metrics: Readonly<StripMetrics>): number {
  const n = Math.max(1, Math.round(columns));
  if (n === 1) return metrics.column;
  return 2 * metrics.pad + n * metrics.columnCell + (n - 1) * metrics.gap;
}

/** The band standing beside the picture: justified rows whose target sits N landscape pictures side by side. */
export function columnLayout({
  items,
  width,
  metrics,
  captions = 'auto',
}: {
  items: readonly StripItem[];
  width: number;
  metrics: Readonly<StripMetrics>;
  captions?: CaptionMode;
}): StripLayout {
  const inner = Math.max(0, width - 2 * metrics.pad);
  const columns = columnsForWidth(width, metrics);
  const target = (inner - (columns - 1) * metrics.gap) / columns / 1.5;
  const cap = captionFor(target, metrics, captions);
  const grid = justifyRows(items, inner, target, metrics.gap, cap);
  return {
    cells: grid.cells.map((c) => ({ ...c, x: c.x + metrics.pad, y: c.y + metrics.pad })),
    width,
    height: grid.height + 2 * metrics.pad,
    axis: 'y',
    cellHeight: target,
    rows: 0,
    columns,
  };
}

/** The contact sheet: the rows again at their own size, every caption drawn. */
export function sheetLayout({
  items,
  width,
  thumb,
  metrics,
}: {
  items: readonly StripItem[];
  width: number;
  thumb: number;
  metrics: Readonly<StripMetrics>;
}): StripLayout {
  const gap = metrics.gap + 2;
  const grid = justifyRows(items, Math.max(0, width), thumb, gap, metrics.cap);
  return { cells: grid.cells, width, height: grid.height, axis: 'y', cellHeight: thumb, rows: 0, columns: 0 };
}

/** A thumbnail size one step up or down, held in its reach. */
export function stepThumb(value: number, direction: 1 | -1, metrics: Readonly<StripMetrics>, which: 'band' | 'sheet'): number {
  const [min, max, step] =
    which === 'sheet' ? [metrics.sheetMin, metrics.sheetMax, metrics.sheetStep] : [metrics.thumbMin, metrics.thumbMax, metrics.thumbStep];
  return Math.min(max, Math.max(min, value + direction * step));
}

/** The most a band under the picture may take: what leaves the stage its least. */
export function maxBandHeight(columnHeight: number, metrics: Readonly<StripMetrics>): number {
  return Math.max(metrics.head, columnHeight - metrics.grip - metrics.stageMin);
}

/** The most a column beside the picture may take. */
export function maxBandWidth(columnWidth: number, metrics: Readonly<StripMetrics>): number {
  return Math.max(metrics.rail, columnWidth - metrics.grip - 320);
}

/** A band dragged under this is folded to its rail. */
export function foldBelow(metrics: Readonly<StripMetrics>, side: boolean): number {
  return side ? metrics.columnMin - 30 : metrics.head + 34;
}

/** The least a band may be once it is NOT folded — a sliver of body is no band. */
export function leastBand(metrics: Readonly<StripMetrics>, side: boolean): number {
  return side ? metrics.columnMin : metrics.head + 2 * metrics.pad + 52;
}

/**
 * The band's extent after a drag: folded under the threshold, else held
 * between the least band and the most the stage can give.
 */
export function bandAfterDrag(
  dragged: number,
  metrics: Readonly<StripMetrics>,
  side: boolean,
  max: number,
): { folded: boolean; size: number | null } {
  if (dragged < foldBelow(metrics, side)) return { folded: true, size: null };
  return { folded: false, size: Math.min(max, Math.max(leastBand(metrics, side), dragged)) };
}

/**
 * "Height follows the roll": the band takes the room the roll's MEDIAN picture
 * leaves under itself at the column's width — sized against the roll rather
 * than the open picture, so stepping from a landscape to a portrait moves
 * nothing. Never less than one row, never more than the stage allows.
 */
export function autoBandHeight({
  columnWidth,
  columnHeight,
  aspect,
  metrics,
}: {
  columnWidth: number;
  columnHeight: number;
  aspect: number;
  metrics: Readonly<StripMetrics>;
}): number {
  const least = heightForRows(1, metrics, metrics.thumb);
  const pictureHeight = columnWidth / clampAspect(aspect);
  const room = columnHeight - metrics.grip - pictureHeight;
  return Math.min(maxBandHeight(columnHeight, metrics), Math.max(least, room));
}

// --- the device's preferences ------------------------------------------------

export interface StripPrefs {
  place: StripPlace;
  /** The band's height under the picture, or null for one row. */
  height: number | null;
  /** The band's width beside the picture, or null for one column. */
  width: number | null;
  folded: boolean;
  /** The height follows the roll's median picture (under the picture only). */
  auto: boolean;
  thumb: number;
  sheet: number;
}

export function defaultStripPrefs(kind: StripKind): StripPrefs {
  const m = STRIP_METRICS[kind];
  return { place: 'bottom', height: null, width: null, folded: false, auto: false, thumb: m.thumb, sheet: m.sheet };
}

/** Where the device keeps them — one entry per shell, so a phone and a desktop do not share a size. */
export function stripPrefsKey(kind: StripKind): string {
  return `atelier.develop.strip.${kind}`;
}

const isPlace = (v: unknown): v is StripPlace => v === 'bottom' || v === 'left' || v === 'right';
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** A stored preference read back: anything missing or odd falls to the default, a phone never keeps a column. */
export function readStripPrefs(raw: unknown, kind: StripKind): StripPrefs {
  const d = defaultStripPrefs(kind);
  const m = STRIP_METRICS[kind];
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const place = kind === 'phone' ? 'bottom' : isPlace(r.place) ? r.place : d.place;
  return {
    place,
    height: typeof r.height === 'number' && Number.isFinite(r.height) && r.height > 0 ? r.height : null,
    width: typeof r.width === 'number' && Number.isFinite(r.width) && r.width > 0 ? r.width : null,
    folded: r.folded === true,
    auto: r.auto === true,
    thumb: num(r.thumb, m.thumbMin, m.thumbMax, m.thumb),
    sheet: num(r.sheet, m.sheetMin, m.sheetMax, m.sheet),
  };
}

/** The band's extent on its axis as the preferences say it, before the drag's clamp. */
export function bandSize(prefs: StripPrefs, metrics: Readonly<StripMetrics>): number {
  const side = prefs.place !== 'bottom';
  if (prefs.folded) return side ? metrics.rail : metrics.head;
  if (side) return prefs.width ?? widthForColumns(1, metrics);
  return prefs.height ?? heightForRows(1, metrics, prefs.thumb);
}

// --- what the band SHOWS -----------------------------------------------------

/**
 * One filter for the band and the sheet: the roll's own four (all, edited,
 * leaving, held back), the ignored ones alone, and Winnow's culling where an
 * instance answered (`passesCull`). A string key, so it is a menu's value and
 * a session's state.
 */
export type StripFilterKey = 'all' | DeliveryFilter | 'ignored' | `cull:${string}`;

export interface StripFilterOption {
  key: StripFilterKey;
  label: string;
  /** Winnow's — offered only when the roll has an instance to ask. */
  winnow: boolean;
}

export const STRIP_FILTERS: readonly StripFilterOption[] = [
  { key: 'all', label: 'All', winnow: false },
  { key: 'edited', label: 'Edited', winnow: false },
  { key: 'leaving', label: 'To export', winnow: false },
  { key: 'held', label: 'Held back', winnow: false },
  { key: 'ignored', label: 'Ignored', winnow: false },
  ...CULL_FILTERS.filter((f) => f.kind !== 'all').map(
    (f): StripFilterOption => ({ key: `cull:${cullFilterKey(f)}`, label: `Winnow: ${cullFilterLabel(f).toLowerCase()}`, winnow: true }),
  ),
];

export function readStripFilter(key: unknown): StripFilterKey {
  return STRIP_FILTERS.find((f) => f.key === key)?.key ?? 'all';
}

export function stripFilterLabel(key: StripFilterKey): string {
  return STRIP_FILTERS.find((f) => f.key === key)?.label ?? 'All';
}

/** The Winnow filter a key names, or null for one of the roll's own. */
export function cullFilterOf(key: StripFilterKey): CullFilter | null {
  if (!key.startsWith('cull:')) return null;
  const inner = key.slice('cull:'.length);
  return CULL_FILTERS.find((f) => cullFilterKey(f) === inner) ?? null;
}

/**
 * Whether a picture passes the band's filter. `ignored` is the one filter an
 * ignored picture passes; every other answer is `matchesDeliveryFilter`'s,
 * which refuses it, or Winnow's over the culling the instance gave.
 */
export function passesStripFilter(p: RollPicture, key: StripFilterKey, culling?: Culling | null): boolean {
  if (key === 'all') return true;
  if (key === 'ignored') return isIgnored(p);
  const cull = cullFilterOf(key);
  if (cull) return !isIgnored(p) && passesCull(culling, cull);
  return matchesDeliveryFilter(p, key as DeliveryFilter);
}
