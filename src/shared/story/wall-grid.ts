/**
 * The wall's grid — « Une, puis mille »: how many columns and rows, the gap
 * between the pictures, their corners, a few pictures bigger than the rest,
 * the order they are laid in and how close the camera ends. (pure)
 *
 * The series' look (`StoryScript.look.wall`), one for every post, because
 * counting thins the pictures to the grid's cell count (`wallPicks`). A grid
 * is laid so its CENTRE cell sits on the frame's centre — the cell the camera
 * starts on, the hook's one photo — and spills past the frame's edges as
 * needed: the default (10 columns, square, 6 px gap) is exactly the wall as
 * it was drawn before it had settings.
 */
import { H, W } from './charte';
import { rng } from './motion';

export type WallOrder = 'rows' | 'columns' | 'centre' | 'shuffle';
export const WALL_ORDERS: readonly WallOrder[] = ['rows', 'columns', 'centre', 'shuffle'];
/** How the pictures are grouped: not at all, by the trip's stage, or by month — each group a band of rows. */
export type WallGroupBy = 'none' | 'stage' | 'month';
export const WALL_GROUP_BYS: readonly WallGroupBy[] = ['none', 'stage', 'month'];

export interface WallGrid {
  /** Columns across the frame. */
  cols: number;
  /** Rows down the frame; 0 = as many as square cells need. */
  rows: number;
  /** Pixels between two pictures (the frame is 1080 wide). */
  gap: number;
  /** A picture's corner radius, in pixels. */
  radius: number;
  /** The share of the wall given to pictures twice as big (2 × 2 cells), 0 to 0.5. */
  big: number;
  /** The order the pictures (in day order) are laid in: along the rows, down the columns, out from the centre, or shuffled. */
  order: WallOrder;
  /** How close the camera ends: 1 = the whole frame of pictures, 2 = twice as close. */
  zoom: number;
  /** Grouped by stage or month: each group its own band of rows, in day order inside. */
  group: WallGroupBy;
  /** A grouped wall names each band on its first picture. */
  labels: boolean;
}

export const WALL_DEFAULTS: WallGrid = { cols: 10, rows: 0, gap: 6, radius: 0, big: 0, order: 'rows', zoom: 1, group: 'none', labels: true };

/** The settings' bounds; a script asking for more is brought back into them. */
export const WALL_LIMITS = {
  cols: [3, 16],
  rows: [4, 30],
  gap: [0, 40],
  radius: [0, 40],
  big: [0, 0.5],
  zoom: [1, 2.5],
} as const;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A script's `look.wall`, kept field by field when well formed; what is left out keeps its default. */
export function readWallGrid(raw: unknown): Partial<WallGrid> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<WallGrid> = {};
  const cols = num(r.cols);
  if (cols !== undefined) out.cols = Math.round(clamp(cols, WALL_LIMITS.cols));
  const rows = num(r.rows);
  if (rows !== undefined) out.rows = rows <= 0 ? 0 : Math.round(clamp(rows, WALL_LIMITS.rows));
  const gap = num(r.gap);
  if (gap !== undefined) out.gap = clamp(gap, WALL_LIMITS.gap);
  const radius = num(r.radius);
  if (radius !== undefined) out.radius = clamp(radius, WALL_LIMITS.radius);
  const big = num(r.big);
  if (big !== undefined) out.big = clamp(big, WALL_LIMITS.big);
  if (typeof r.order === 'string' && (WALL_ORDERS as readonly string[]).includes(r.order)) out.order = r.order as WallOrder;
  const zoom = num(r.zoom);
  if (zoom !== undefined) out.zoom = clamp(zoom, WALL_LIMITS.zoom);
  if (typeof r.group === 'string' && (WALL_GROUP_BYS as readonly string[]).includes(r.group)) out.group = r.group as WallGroupBy;
  if (typeof r.labels === 'boolean') out.labels = r.labels;
  return Object.keys(out).length ? out : undefined;
}

export const wallGrid = (given?: Partial<WallGrid> | null): WallGrid => ({ ...WALL_DEFAULTS, ...(given ?? {}) });

/** One picture's place on the wall, in the frame's pixels at the camera's end (zoom 1). */
export interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its distance from the centre cell, in cells — the reveal fades the wall in by it. */
  d: number;
  /** The centre cell, where the camera starts. */
  centre: boolean;
  /** On a grouped wall: the picture it shows (an index into the wall's pictures), its band, and whether it opens the band. */
  pic?: number;
  band?: number;
  head?: boolean;
  /** Its cell (top-left for a big one), and 2 for a big picture — what the wall's motion moves by lane (`wall-motion.ts`). */
  row: number;
  col: number;
  span: number;
}

/** A group of the wall's pictures, consecutive in day order: its name and how many pictures it holds. */
export interface WallGroup {
  label: string;
  n: number;
}

/** A stage as counting froze it: its name and its days (`ScriptFacts.stages`). */
export interface WallStage {
  label: string;
  from: string;
  to: string;
}

/**
 * The wall's pictures cut into groups by their days (`ScriptFacts.tileDays`):
 * by the stage a day falls in — a day in none joins the stage before it — or
 * by month. Consecutive runs only, so the groups follow the wall's day order.
 * Null when there is nothing to group by. (pure)
 */
export function wallGroups(days: readonly string[] | undefined, by: WallGroupBy, stages: readonly WallStage[] | undefined, monthLabel: (iso: string) => string): WallGroup[] | null {
  if (by === 'none' || !days?.length) return null;
  if (by === 'stage' && !stages?.length) return null;
  const sorted = by === 'stage' ? [...stages!].sort((a, b) => a.from.localeCompare(b.from)) : [];
  const keyOf = (day: string): string => {
    if (by === 'month') return day.slice(0, 7);
    const inside = sorted.find((s) => s.from <= day && day <= s.to);
    if (inside) return inside.label;
    const before = sorted.filter((s) => s.from <= day).pop();
    return (before ?? sorted[0]).label;
  };
  const out: WallGroup[] = [];
  for (const day of days) {
    const key = keyOf(day);
    const label = by === 'month' ? monthLabel(`${key}-01`) : key;
    const last = out[out.length - 1];
    if (last && last.label === label) last.n += 1;
    else out.push({ label, n: 1 });
  }
  return out;
}

/** Rows given to each group, in proportion to its pictures, one row at least, `R` in all (largest remainders). */
export function bandRows(sizes: readonly number[], R: number): number[] {
  const N = sizes.reduce((a, b) => a + b, 0);
  const exact = sizes.map((n) => (n / N) * R);
  const rows = exact.map((e) => Math.max(1, Math.floor(e)));
  let sum = rows.reduce((a, b) => a + b, 0);
  while (sum > R) {
    const i = rows.reduce((best, v, k) => (v > rows[best] ? k : best), 0);
    rows[i] -= 1;
    sum -= 1;
  }
  const byRemainder = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; sum < R; k = (k + 1) % byRemainder.length) {
    rows[byRemainder[k][1]] += 1;
    sum += 1;
  }
  return rows;
}

export interface WallLayout {
  /** The pictures' places, in the order the pictures are laid (picture 0 first). */
  rects: WallRect[];
  cellW: number;
  cellH: number;
  /** The grid's top-left corner and its size in cells: where a moving lane wraps. */
  x0: number;
  y0: number;
  cols: number;
  rows: number;
}

const layouts = new Map<string, WallLayout>();

/**
 * Where each picture of the wall goes. Cells are counted out from the centre
 * one until the frame is covered; a big picture takes 2 × 2 cells, placed
 * by a seeded draw (the same wall every time), never over the centre cell.
 */
export function wallLayout(given?: Partial<WallGrid> | null, groups?: readonly number[] | null): WallLayout {
  const g = wallGrid(given);
  const key = `${g.cols}|${g.rows}|${g.big}|${g.order}|${g.gap}|${groups?.join(',') ?? ''}`;
  const known = layouts.get(key);
  if (known) return known;
  const cellW = W / g.cols;
  const cellH = g.rows > 0 ? H / g.rows : cellW;
  // Cells either side of the centre one until the frame's edge is covered.
  const nx = Math.ceil((W / 2 - cellW / 2) / cellW);
  const ny = Math.ceil((H / 2 - cellH / 2) / cellH);
  const C = 2 * nx + 1;
  const R = 2 * ny + 1;
  const ci = nx;
  const ri = ny;
  const x0 = W / 2 - cellW / 2 - nx * cellW;
  const y0 = H / 2 - cellH / 2 - ny * cellH;
  // A grouped wall: each group a band of whole rows, in proportion to its pictures.
  const banded = groups && groups.length > 1 && groups.length <= R && groups.every((n) => n > 0);
  const bandOf = new Int16Array(R);
  if (banded) {
    let r = 0;
    bandRows(groups, R).forEach((rows, b) => {
      for (let k = 0; k < rows; k++) bandOf[r++] = b;
    });
  }
  const taken = new Uint8Array(C * R);
  const placed: { c: number; r: number; span: number }[] = [];
  // The big pictures first: a seeded shuffle of every top-left corner, each kept when its four cells are free.
  const want = Math.round((g.big * C * R) / 4);
  if (want > 0) {
    const corners: number[] = [];
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) corners.push(r * C + c);
    const draw = rng(7);
    for (let i = corners.length - 1; i > 0; i--) {
      const j = Math.floor(draw() * (i + 1));
      [corners[i], corners[j]] = [corners[j], corners[i]];
    }
    for (const k of corners) {
      if (placed.length >= want) break;
      const r = Math.floor(k / C);
      const c = k % C;
      const four = [k, k + 1, k + C, k + C + 1];
      if (four.some((q) => taken[q])) continue;
      if ((r === ri || r + 1 === ri) && (c === ci || c + 1 === ci)) continue;
      if (banded && bandOf[r] !== bandOf[r + 1]) continue;
      four.forEach((q) => (taken[q] = 1));
      placed.push({ c, r, span: 2 });
    }
  }
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (!taken[r * C + c]) placed.push({ c, r, span: 1 });
  const rects = placed.map(({ c, r, span }): WallRect & { c: number; r: number } => {
    const mx = c + span / 2 - (ci + 0.5);
    const my = r + span / 2 - (ri + 0.5);
    return {
      x: x0 + c * cellW,
      y: y0 + r * cellH,
      w: span * cellW,
      h: span * cellH,
      d: Math.hypot(mx, my),
      centre: span === 1 && c === ci && r === ri,
      c,
      r,
      row: r,
      col: c,
      span,
    };
  });
  const byRows = (a: { c: number; r: number }, b: { c: number; r: number }) => a.r - b.r || a.c - b.c;
  if (banded) {
    // Day order inside each band, along its rows or down its columns; the band's top row stands apart.
    const byCols = (a: { c: number; r: number }, b: { c: number; r: number }) => a.c - b.c || a.r - b.r;
    rects.sort((a, b) => bandOf[a.r] - bandOf[b.r] || (g.order === 'columns' ? byCols(a, b) : byRows(a, b)));
    const sep = Math.max(8, g.gap * 2);
    const firstRow = (b: number) => bandOf.indexOf(b);
    let start = 0;
    const counts = new Map<number, number>();
    rects.forEach((q) => counts.set(bandOf[q.r], (counts.get(bandOf[q.r]) ?? 0) + 1));
    const startOf: number[] = [];
    groups.forEach((n, b) => {
      startOf[b] = start;
      start += n;
    });
    const seen = new Map<number, number>();
    // A band is named on its first place wholly inside the frame (the grid spills past every edge).
    const heads = new Map<number, (typeof rects)[number]>();
    for (const q of rects) {
      const b = bandOf[q.r];
      if (!heads.has(b) && q.x >= -0.5 && q.y >= -0.5 && q.x + q.w <= W + 0.5) heads.set(b, q);
    }
    const layout: WallLayout = {
      rects: rects.map((q) => {
        const b = bandOf[q.r];
        const j = seen.get(b) ?? 0;
        seen.set(b, j + 1);
        const opens = b > 0 && q.r === firstRow(b);
        return {
          x: q.x,
          y: q.y + (opens ? sep : 0),
          w: q.w,
          h: q.h - (opens ? sep : 0),
          d: q.d,
          centre: q.centre,
          band: b,
          head: (heads.get(b) ?? rects.find((x) => bandOf[x.r] === b)) === q,
          pic: startOf[b] + pictureFor(j, counts.get(b) ?? 1, groups[b]),
          row: q.row,
          col: q.col,
          span: q.span,
        };
      }),
      cellW,
      cellH,
      x0,
      y0,
      cols: C,
      rows: R,
    };
    if (layouts.size > 32) layouts.clear();
    layouts.set(key, layout);
    return layout;
  }
  if (g.order === 'columns') rects.sort((a, b) => a.c - b.c || a.r - b.r);
  else if (g.order === 'centre') rects.sort((a, b) => (a.centre ? -1 : b.centre ? 1 : a.d - b.d || byRows(a, b)));
  else if (g.order === 'shuffle') {
    rects.sort(byRows);
    const draw = rng(19);
    for (let i = rects.length - 1; i > 0; i--) {
      const j = Math.floor(draw() * (i + 1));
      [rects[i], rects[j]] = [rects[j], rects[i]];
    }
  } else rects.sort(byRows);
  const layout: WallLayout = {
    rects: rects.map((q) => ({ x: q.x, y: q.y, w: q.w, h: q.h, d: q.d, centre: q.centre, row: q.row, col: q.col, span: q.span })),
    cellW,
    cellH,
    x0,
    y0,
    cols: C,
    rows: R,
  };
  if (layouts.size > 32) layouts.clear();
  layouts.set(key, layout);
  return layout;
}

/** How many pictures the wall holds — what counting thins the days' pictures to. */
export const wallCells = (given?: Partial<WallGrid> | null): number => wallLayout(given).rects.length;

/**
 * Which of `n` pictures (in day order) goes on place `i` of `cells`: spread
 * evenly, so a wall with more places than pictures repeats each one beside
 * itself and keeps the days in order, and one with fewer leaves some out.
 */
export const pictureFor = (i: number, cells: number, n: number): number => (n <= 0 ? -1 : Math.min(n - 1, Math.floor((i * n) / cells)));
