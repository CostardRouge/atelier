/**
 * Captions laid out like the hook (strategy R4): the badge wraps in a column
 * the author sets and stops at three lines; a caption wrapped in a fixed
 * 800 px and grew UPWARD with no limit, so a long one climbed into the
 * picture. Now a caption takes the series' column, its line limit — past
 * it the words shrink a step at a time, as the badge's do, unless the author
 * lets it grow — and the platforms' buttons as a HARD EDGE: its right side
 * stops short of the action column and its last line stays above the
 * platform's caption band, wherever the Studio moved it. The defaults are
 * the caption as it was (800 px, its baseline), so a caption of one or two
 * lines draws exactly as before. (pure over `measure`)
 */
import { SAFE_ZONE_PRESETS } from '../overlay/guides';

export type CaptionEdge = 'all' | 'tiktok' | 'reels' | 'shorts' | 'none';
export const CAPTION_EDGES: readonly CaptionEdge[] = ['all', 'tiktok', 'reels', 'shorts', 'none'];

export interface CaptionLook {
  /** How wide a line may run, a share of the frame's width. */
  column: number;
  /** Lines before a long caption shrinks. */
  maxLines: number;
  /** Past the limit: shrink to fit it, or grow upward as before. */
  long: 'shrink' | 'grow';
  /** Whose buttons the caption keeps clear of: every short-video platform, one, or none. */
  edge: CaptionEdge;
}

export const CAPTION_LOOK_DEFAULTS: CaptionLook = { column: 800 / 1080, maxLines: 3, long: 'shrink', edge: 'all' };
export const CAPTION_COLUMN = [0.4, 0.92] as const;
export const CAPTION_LINES = [1, 5] as const;
/** The smallest a long caption shrinks to, a share of its size. */
export const CAPTION_SHRINK_FLOOR = 0.6;
/** Room kept between the words and a platform's band, frame pixels. */
export const EDGE_MARGIN = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const captionLook = (given?: Partial<CaptionLook> | null): CaptionLook => ({ ...CAPTION_LOOK_DEFAULTS, ...(given ?? {}) });

/** A script's `look.captions`, kept field by field when well formed. (pure) */
export function readCaptionLook(raw: unknown): Partial<CaptionLook> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<CaptionLook> = {};
  if (typeof r.column === 'number' && Number.isFinite(r.column)) out.column = clamp(r.column, ...CAPTION_COLUMN);
  if (typeof r.maxLines === 'number' && Number.isFinite(r.maxLines)) out.maxLines = Math.round(clamp(r.maxLines, ...CAPTION_LINES));
  if (r.long === 'shrink' || r.long === 'grow') out.long = r.long;
  if (typeof r.edge === 'string' && (CAPTION_EDGES as readonly string[]).includes(r.edge)) out.edge = r.edge as CaptionEdge;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Where the platforms' buttons begin, frame pixels: the right edge of the
 * words (the action column's left side, over the caption's height) and the
 * lowest a last line may sit (the caption band's top). Infinity = no edge. (pure)
 */
export function captionEdges(edge: CaptionEdge, width = 1080, height = 1920): { right: number; bottom: number } {
  if (edge === 'none') return { right: Infinity, bottom: Infinity };
  const presets = SAFE_ZONE_PRESETS.filter((p) => p.aspect < 1 && (edge === 'all' || p.id === edge));
  let right = Infinity;
  let bottom = Infinity;
  for (const p of presets)
    for (const d of p.deadzones) {
      // The action column: a narrow band at the right, over the middle of the frame.
      if (d.x > 0.5 && d.h < 0.7) right = Math.min(right, d.x * width - EDGE_MARGIN);
      // The caption band: full or most of the width, at the foot.
      else if (d.y > 0.5 && d.w > 0.5) bottom = Math.min(bottom, d.y * height - EDGE_MARGIN);
    }
  return { right, bottom };
}

export interface CaptionWord {
  word: string;
  i: number;
  ww: number;
}

export interface CaptionLaid {
  lines: CaptionWord[][];
  size: number;
  lineHeight: number;
  /** The first line's baseline, and the last's, in the caption's own coordinates (before the Studio's move). */
  top: number;
  baseline: number;
}

/**
 * Lay a caption's words: wrapped in the column (and short of the action
 * column), shrunk a step at a time past the line limit when `long` is
 * `shrink`, its last line raised so that — moved by the Studio's `dy` — it
 * stays above the caption band. `measure(word, size)` is the word's width
 * at a size, the space included as `measure(' ', size)`. (pure)
 */
export function layCaption(
  text: string,
  measure: (word: string, size: number) => number,
  look: CaptionLook,
  base: { x: number; baseline: number; size: number; lineHeight: number },
  dy = 0,
): CaptionLaid {
  const words = text.split(/\s+/).filter(Boolean);
  const edges = captionEdges(look.edge);
  const column = Math.max(120, Math.min(look.column * 1080, edges.right - base.x));
  const wrap = (size: number): CaptionWord[][] => {
    const lines: CaptionWord[][] = [[]];
    let w = 0;
    const sp = measure(' ', size);
    words.forEach((word, i) => {
      const ww = measure(word, size);
      if (lines[lines.length - 1].length && w + sp + ww > column) {
        lines.push([]);
        w = 0;
      }
      const L = lines[lines.length - 1];
      L.push({ word, i, ww });
      w += (L.length > 1 ? sp : 0) + ww;
    });
    return lines;
  };
  let size = base.size;
  let lines = wrap(size);
  if (look.long === 'shrink') {
    // Never under the floor: a caption too long for its lines at the floor keeps its words readable and takes more lines.
    const floor = base.size * CAPTION_SHRINK_FLOOR;
    while (lines.length > look.maxLines && size > floor) {
      size = Math.max(floor, size * 0.92);
      lines = wrap(size);
    }
  }
  const lh = size * base.lineHeight;
  // The last line's descenders stay above the band, wherever the Studio moved the caption.
  const descent = size * 0.25;
  const baseline = Math.min(base.baseline, edges.bottom - descent - dy);
  return { lines, size, lineHeight: lh, top: baseline - (lines.length - 1) * lh, baseline };
}
