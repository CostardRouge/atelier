/**
 * The atlas's OVERLAY — the words and numbers over the map, laid out in six
 * spots (the four corners and the middle of the top and bottom edges) and
 * drawn by the suite's own text engine (`drawOverlays`) under the author's
 * title style, so a title here wears exactly what it wears in the Studio and
 * in Trips (the same presets, the same panel, the same glow).
 *
 * Pieces sharing a spot stack in one fixed order — title, subtitle, dates,
 * drone, spotlight card, clock, counter, curve, statistics, credits — top
 * down in a top spot, ending on the edge in a bottom one. A statistic's
 * numeral is an ODOMETER, so a live count rolls instead of jumping.
 *
 * The activity curve is the one piece the engine has no element for; it is
 * drawn here, in the accent, in its slot of the stack.
 */

import { drawOverlays } from '../../shared/overlay/draw-overlays';
import type { Anchor, OverlayElement } from '../../shared/overlay/overlay-types';
import { resolveElementStyle, type StyleTheme, type ThemableKey } from '../../shared/overlay/title-styles';
import type { Ctx2D } from './atlas-paint';
import { parseHex, rgba } from './atlas-colour';
import type { Rect, Spot } from './atlas-settings';
import { luminance, type StickerBacking } from './atlas-sticker';
import type { AtlasLayer, OverlayHit } from './atlas-layers';
import { breakLines, fitSize } from './atlas-text';
import { SPOT_MARGIN, type Align, type FreePlace, type PieceId } from './atlas-place';

/** One line of text in a stack. */
export interface TextLine {
  kind: 'text';
  text: string;
  /** Font size, px on a 1080 short side, before the theme's own scale. */
  size: number;
  /** Small caps label: uppercase, spaced, a lighter weight. */
  label?: boolean;
  /** Drawn in the accent rather than the theme's ink. */
  accent?: boolean;
  /** The weight, pinned against the theme. */
  weight?: 400 | 500 | 600 | 700;
  odometer?: number;
  /** Room under the line, in line heights. */
  gapAfter?: number;
  /**
   * Kept within `maxW` of the area's width: broken into lines (the author's
   * own breaks kept) or made smaller until it fits on one. Without it a
   * line is drawn as it is.
   */
  fit?: { maxW: number; mode: 'wrap' | 'shrink' };
}

/** Statistics side by side, each its value over its label. */
export interface StatRow {
  kind: 'row';
  items: { value: string; label: string; odometer?: number }[];
  size: number;
  /**
   * Kept within `maxW` of the area's width: in a grid of `columns` (every
   * cell as wide as the widest), or as rows broken where the next item
   * would pass the width. Either way made smaller if one line still would.
   */
  fit?: { maxW: number; columns?: number };
  /** Every item laid in a cell this wide, px — a grid's columns. */
  cell?: number;
  /** The row laid as if it held this many cells — a grid's short last row keeps its columns. */
  slots?: number;
  /** Room under the row, in row heights. */
  gapAfter?: number;
}

/** Statistics one under the other, each its value then its label. */
export interface StatColumn {
  kind: 'column';
  items: { value: string; label: string; odometer?: number }[];
  size: number;
}

export interface CurveBlock {
  kind: 'curve';
  activity: readonly number[];
  /** 0..1, where the playhead is. */
  at: number;
  ends: [string, string];
  /** Height, px on a 1080 short side. */
  size: number;
}

/** A logo a sticker can draw: any picture a canvas takes, and its width over its height. */
export interface StickerLogoSource {
  image: CanvasImageSource;
  ratio: number;
}

/** One sticker: an optional logo, a heavy run and a light run of text. */
export interface StickerItem {
  bold: string;
  light: string;
  logo: StickerLogoSource | null;
  /** The logo drawn in the ink (its shape kept), or as the file is. */
  tint: boolean;
}

/** Drone stickers, one under the other. */
export interface StickerBlock {
  kind: 'sticker';
  items: StickerItem[];
  /** Font size, px on a 1080 short side. */
  size: number;
  ink: string;
  backing: StickerBacking;
  gapAfter?: number;
}

/** Whose a block is: the inspector layer a click on it opens. */
interface Owned {
  owner?: AtlasLayer;
  /** The draggable piece it belongs to (`atlas-place.ts`). */
  piece?: PieceId;
  /** This block's own fade, times the layout's (an intro's lines arrive one by one). */
  alpha?: number;
}

export type Block = (TextLine | StatRow | StatColumn | CurveBlock | StickerBlock) & Owned;

/** A spot of the frame, or its middle (`mc`) — where an intro or an outro stacks its lines. */
export type LayoutSpot = Spot | 'mc';

export interface OverlayLayout {
  spots: Partial<Record<LayoutSpot, Block[]>>;
  theme: StyleTheme;
  accent: string;
  /** Every size times this. */
  scale: number;
  /** Where the middle stack's centre sits, a fraction of the area's height (0.5 when absent). */
  middleAt?: number;
  /** Every block moved down by this, a fraction of the area's short side (a stack rising into place). */
  shiftY?: number;
  /** Pieces placed by hand, each a stack of its own at its place. */
  free?: { place: FreePlace; blocks: Block[] }[];
}

/** Every stack is laid from its top, at the edge it grows from. */
const ANCHOR_OF: Record<Align, Anchor> = { left: 'top-left', center: 'top-center', right: 'top-right' };

const LINE = 1.22;

function textElement(id: string, text: string, anchor: Anchor, x: number, y: number, sizeFrac: number, overrides: Partial<OverlayElement>, pinned: ThemableKey[]): OverlayElement {
  return {
    id,
    kind: 'text',
    text,
    anchor,
    x,
    y,
    sizeFrac,
    fontFamily: 'Space Grotesk',
    weight: 600,
    italic: false,
    color: '#ffffff',
    legibility: { mode: 'none', color: 'rgba(0,0,0,0.5)', padFrac: 0.3 },
    visible: true,
    ...overrides,
    styleOverrides: pinned,
  };
}

/**
 * Draw the overlay inside `area` (pixels of the frame). `unit` is the area's
 * short side over 1080. Returns the box of every owned block as drawn, so a
 * click on the stage can open what it landed on.
 */
export function paintOverlay(ctx: Ctx2D, layout: OverlayLayout, area: Rect, alpha = 1): OverlayHit[] {
  const short = Math.min(area.w, area.h);
  const unit = (short / 1080) * layout.scale;
  const margin = SPOT_MARGIN * short;
  const theme = layout.theme;
  const accent = layout.accent;
  const elements: OverlayElement[] = [];
  const curves: { block: CurveBlock; x: number; y: number; w: number; h: number; alpha: number }[] = [];
  const stickers: { block: StickerBlock; item: StickerItem; x: number; y: number; alpha: number }[] = [];
  const hits: OverlayHit[] = [];
  /** Each text element's fade, by id — the engine is handed one group per fade. */
  const fades = new Map<string, number>();
  let blockAlpha = alpha;
  let seq = 0;

  /** The element a line becomes, with its measured height. */
  const lineElement = (line: TextLine, anchor: Anchor, x: number, y: number): OverlayElement => {
    const pinned: ThemableKey[] = [];
    const over: Partial<OverlayElement> = {};
    if (line.label) {
      pinned.push('uppercase', 'letterSpacing', 'weight');
      over.uppercase = true;
      over.letterSpacingEm = 0.14;
      over.weight = 500;
    }
    if (line.weight) {
      if (!pinned.includes('weight')) pinned.push('weight');
      over.weight = line.weight;
    }
    if (line.accent) {
      pinned.push('color');
      over.color = accent;
    }
    if (line.odometer !== undefined) over.odometer = line.odometer;
    const el = textElement(`o${seq++}`, line.text, anchor, (x - area.x) / area.w, (y - area.y) / area.h, (line.size * unit) / short, over, pinned);
    fades.set(el.id, blockAlpha);
    return el;
  };

  /** A line's height on the frame, the theme's own scale included. */
  const heightOf = (line: { size: number }) => line.size * unit * theme.style.sizeScale * LINE;

  /** The width a text will take, its digits all at their widest (an odometer's cells). */
  const widthOf = (text: string, size: number, label: boolean, weight?: number): number => {
    const probe = textElement('probe', text, 'top-left', 0, 0, (size * unit) / short, label ? { uppercase: true, letterSpacingEm: 0.14, weight: 500 } : weight ? { weight: weight as 400 } : {}, label ? ['uppercase', 'letterSpacing', 'weight'] : weight ? ['weight'] : []);
    const rs = resolveElementStyle(probe, theme);
    const px = rs.sizeFrac * short;
    ctx.font = `${rs.italic ? 'italic ' : ''}${rs.weight} ${px}px '${rs.fontFamily}'`;
    const shown = (rs.uppercase ? text.toUpperCase() : text).replace(/[0-9]/g, '0');
    return ctx.measureText(shown).width + rs.letterSpacingEm * px * shown.length;
  };

  /**
   * A text with a width to keep or lines of its own, as the lines it draws:
   * one block per line, the room under it kept on the last — so the stack
   * lays them out like any other lines and nothing passes the width.
   */
  /** How wide one statistic of a row is drawn: its value or its label, the wider. */
  const cellW = (it: { value: string; label: string }, size: number) => Math.max(widthOf(it.value, size, false), widthOf(it.label, size * 0.42, true));
  const rowGap = (size: number) => size * unit * 0.9;

  const expand = (b: Block): Block[] => {
    if (b.kind === 'row' && b.fit && b.items.length) return expandRow(b, b.fit);
    if (b.kind !== 'text' || (!b.fit && !b.text.includes('\n'))) return [b];
    const measure = (t: string, size = b.size) => widthOf(t, size, !!b.label, b.weight);
    const maxW = b.fit ? b.fit.maxW * area.w : Infinity;
    if (b.fit?.mode === 'shrink') {
      const one = b.text.replace(/\s*\n\s*/g, ' ').trim();
      return [{ ...b, text: one, size: fitSize([one], b.size, maxW, measure) }];
    }
    const lines = breakLines(b.text, maxW, (t) => measure(t));
    // A single word wider than the width is made smaller rather than cut.
    const size = Number.isFinite(maxW) ? fitSize(lines, b.size, maxW, measure) : b.size;
    return lines.map((text, i) => ({ ...b, text, size, gapAfter: i === lines.length - 1 ? b.gapAfter : 0 }));
  };

  /** A row with a width to keep, as the rows it draws (see `StatRow.fit`). */
  const expandRow = (b: StatRow & Owned, fit: NonNullable<StatRow['fit']>): Block[] => {
    const maxW = fit.maxW * area.w;
    const rows: (typeof b.items)[] = [];
    let size = b.size;
    let cell: number | undefined;
    let slots: number | undefined;
    if (fit.columns) {
      const cols = Math.min(fit.columns, b.items.length);
      cell = Math.max(...b.items.map((it) => cellW(it, size)));
      const w = cell * cols + rowGap(size) * (cols - 1);
      if (w > maxW) {
        size *= maxW / w;
        cell *= maxW / w;
      }
      slots = cols;
      for (let i = 0; i < b.items.length; i += cols) rows.push(b.items.slice(i, i + cols));
    } else {
      // Smaller first if a single statistic is wider than the width.
      const widest = Math.max(...b.items.map((it) => cellW(it, size)));
      if (widest > maxW) size *= maxW / widest;
      let cur: typeof b.items = [];
      let w = 0;
      for (const it of b.items) {
        const cw = cellW(it, size);
        if (cur.length && w + rowGap(size) + cw > maxW) {
          rows.push(cur);
          cur = [];
          w = 0;
        }
        w += (cur.length ? rowGap(size) : 0) + cw;
        cur.push(it);
      }
      rows.push(cur);
    }
    return rows.map((items, i) => ({ ...b, items, size, cell, slots, fit: undefined, gapAfter: i === rows.length - 1 ? b.gapAfter : 0.18 }));
  };

  const blockHeight = (b: Block): number => {
    switch (b.kind) {
      case 'text':
        return heightOf(b) * (1 + (b.gapAfter ?? 0));
      case 'row':
        return (heightOf(b) + heightOf({ size: b.size * 0.42 })) * 1.08 * (1 + (b.gapAfter ?? 0));
      case 'column':
        return b.items.length * heightOf(b) * 1.04;
      case 'curve':
        return b.size * unit + 44 * unit;
      case 'sticker': {
        const m = stickerMetrics(b.size * unit, b.backing);
        return b.items.length * m.boxH + (b.items.length - 1) * m.between + (b.gapAfter ?? 0) * m.boxH;
      }
    }
  };

  // Every stack: a spot's, pinned to its corner or edge, or a piece placed by hand, at its place.
  const stacks: { blocks: Block[]; align: Align; ax: number; top: (total: number) => number }[] = [];
  for (const spot of Object.keys(layout.spots) as LayoutSpot[]) {
    const align: Align = spot[1] === 'l' ? 'left' : spot[1] === 'c' ? 'center' : 'right';
    const bottom = spot[0] === 'b';
    const middle = spot === 'mc';
    stacks.push({
      blocks: layout.spots[spot] ?? [],
      align,
      ax: align === 'left' ? area.x + margin : align === 'center' ? area.x + area.w / 2 : area.x + area.w - margin,
      top: (total) => (middle ? area.y + area.h * (layout.middleAt ?? 0.5) - total / 2 : bottom ? area.y + area.h - margin - total : area.y + margin),
    });
  }
  for (const f of layout.free ?? []) {
    // Held where it was let go, but never pushed out past the area's bottom.
    stacks.push({ blocks: f.blocks, align: f.place.align, ax: area.x + f.place.x * area.w, top: (total) => Math.min(area.y + f.place.y * area.h, area.y + area.h - total) });
  }
  for (const stack of stacks) {
    const blocks = stack.blocks.filter((b) => (b.alpha ?? 1) > 0.001).flatMap(expand);
    if (!blocks.length) continue;
    const total = blocks.reduce((h, b) => h + blockHeight(b), 0);
    const { align, ax } = stack;
    const anchor = ANCHOR_OF[align];
    let y = stack.top(total) + (layout.shiftY ?? 0) * short;
    const colW = Math.min(area.w - 2 * margin, Math.max(300 * unit, area.w * 0.28));

    /** Record a block's box, `w` wide at the spot's alignment. */
    const hit = (b: Block, w: number, h: number) => {
      // A piece too faint to see is not a piece a click lands on.
      if (!b.owner || w <= 0 || h <= 0 || blockAlpha < 0.3) return;
      const x = align === 'left' ? ax : align === 'center' ? ax - w / 2 : ax - w;
      hits.push({ layer: b.owner, piece: b.piece, x, y, w, h });
    };

    for (const b of blocks) {
      const h = blockHeight(b);
      blockAlpha = alpha * (b.alpha ?? 1);
      if (b.kind === 'text') {
        elements.push(lineElement(b, anchor, ax, y));
        if (b.text.trim()) hit(b, widthOf(b.text, b.size, !!b.label, b.weight), heightOf(b));
      } else if (b.kind === 'row') {
        const valueH = heightOf(b);
        const gap = rowGap(b.size);
        const widths = b.items.map((it) => b.cell ?? cellW(it, b.size));
        // A grid's short last row keeps the columns of the rows above it.
        const laid = b.cell && b.slots ? Array<number>(b.slots).fill(b.cell) : widths;
        const rowW = laid.reduce((s, w) => s + w, 0) + gap * Math.max(0, laid.length - 1);
        hit(b, rowW, h);
        let x = align === 'left' ? ax : align === 'center' ? ax - rowW / 2 : ax - rowW;
        b.items.forEach((it, i) => {
          const cx = x + widths[i] / 2;
          elements.push(lineElement({ kind: 'text', text: it.value, size: b.size, odometer: it.odometer }, 'top-center', cx, y));
          elements.push(lineElement({ kind: 'text', text: it.label, size: b.size * 0.42, label: true, accent: true }, 'top-center', cx, y + valueH));
          x += widths[i] + gap;
        });
      } else if (b.kind === 'column') {
        const rowH = heightOf(b) * 1.04;
        const valueW = Math.max(...b.items.map((it) => widthOf(it.value, b.size, false)));
        const labelSize = b.size * 0.46;
        const gap = b.size * unit * 0.45;
        const labelDrop = (heightOf(b) - heightOf({ size: labelSize })) * 0.62;
        hit(b, valueW + gap + Math.max(...b.items.map((it) => widthOf(it.label, labelSize, true))), b.items.length * rowH);
        b.items.forEach((it, i) => {
          const yy = y + i * rowH;
          if (align === 'right') {
            // The label to the left of the value, the values flush right.
            elements.push(lineElement({ kind: 'text', text: it.value, size: b.size, odometer: it.odometer }, 'top-right', ax, yy));
            elements.push(lineElement({ kind: 'text', text: it.label, size: labelSize, label: true, accent: true }, 'top-right', ax - valueW - gap, yy + labelDrop));
          } else {
            const left = align === 'left' ? ax : ax - (valueW + gap + widthOf(it.label, labelSize, true)) / 2;
            elements.push(lineElement({ kind: 'text', text: it.value, size: b.size, odometer: it.odometer }, 'top-left', left, yy));
            elements.push(lineElement({ kind: 'text', text: it.label, size: labelSize, label: true, accent: true }, 'top-left', left + valueW + gap, yy + labelDrop));
          }
        });
      } else if (b.kind === 'sticker') {
        const px = b.size * unit;
        const m = stickerMetrics(px, b.backing);
        const widths = b.items.map((item) => measureSticker(ctx, item, px).w + 2 * m.padX);
        hit(b, Math.max(...widths), b.items.length * m.boxH + (b.items.length - 1) * m.between);
        b.items.forEach((item, i) => {
          const w = widths[i];
          const x = align === 'left' ? ax : align === 'center' ? ax - w / 2 : ax - w;
          stickers.push({ block: b, item, x, y: y + i * (m.boxH + m.between), alpha: blockAlpha });
        });
      } else {
        const w = colW;
        const x = align === 'left' ? ax : align === 'center' ? ax - w / 2 : ax - w;
        hit(b, w, h);
        curves.push({ block: b, x, y: y + 6 * unit, w, h: b.size * unit, alpha: blockAlpha });
      }
      y += h;
    }
  }

  const base = ctx.globalAlpha;
  for (const c of curves) {
    ctx.globalAlpha = base * c.alpha;
    drawCurve(ctx, c.block, c.x, c.y, c.w, c.h, unit, accent, theme);
  }
  for (const st of stickers) {
    ctx.globalAlpha = base * st.alpha;
    drawSticker(ctx, st.item, st.x, st.y, st.block.size * unit, st.block.ink, st.block.backing, unit);
  }
  ctx.globalAlpha = base;

  if (elements.length) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, area.x, area.y);
    // The engine lays elements out in its own frame: the area, at the origin.
    // It sets each element's alpha itself, so a fade is handed to it, one
    // group of elements per fade (one group when nothing fades).
    const groups = new Map<number, OverlayElement[]>();
    for (const el of elements) {
      const a = fades.get(el.id) ?? alpha;
      groups.set(a, [...(groups.get(a) ?? []), el]);
    }
    for (const [a, group] of groups) drawOverlays(ctx, group, null, area.w, area.h, a === 1 ? { theme } : { theme, alpha: a });
    ctx.restore();
  }
  return hits;
}

function drawCurve(ctx: Ctx2D, b: CurveBlock, x: number, y: number, w: number, h: number, unit: number, accentHex: string, theme: StyleTheme): void {
  const accent = parseHex(accentHex);
  const ink = parseHex(theme.style.color);
  const n = b.activity.length;
  if (n < 2) return;
  const max = Math.max(1, ...b.activity);
  const base = y + h;
  const pt = (i: number) => [x + (i / (n - 1)) * w, base - (b.activity[i] / max) * h * 0.92] as const;
  const cut = Math.min(n - 1, Math.round(b.at * (n - 1)));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, 1.6 * unit);
  const curve = (from: number, to: number) => {
    ctx.beginPath();
    const [sx, sy] = pt(from);
    ctx.moveTo(sx, sy);
    for (let i = from + 1; i <= to; i++) {
      const [px, py] = pt(i);
      ctx.lineTo(px, py);
    }
  };
  curve(0, n - 1);
  ctx.strokeStyle = rgba(accent, 0.2);
  ctx.stroke();
  if (cut > 0) {
    curve(0, cut);
    ctx.strokeStyle = rgba(accent, 1);
    ctx.stroke();
    ctx.lineTo(pt(cut)[0], base);
    ctx.lineTo(x, base);
    ctx.closePath();
    ctx.fillStyle = rgba(accent, 0.12);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(ink, 0.3);
  ctx.lineWidth = Math.max(0.5, unit);
  ctx.beginPath();
  ctx.moveTo(x, base + 0.5);
  ctx.lineTo(x + w, base + 0.5);
  ctx.stroke();
  const label = 16 * unit;
  ctx.font = `500 ${label}px '${theme.style.fontFamily}', 'Space Grotesk', sans-serif`;
  ctx.fillStyle = rgba(ink, 0.6);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(b.ends[0], x, base + label * 1.45);
  ctx.textAlign = 'right';
  ctx.fillText(b.ends[1], x + w, base + label * 1.45);
  ctx.restore();
}

// --- the gear sticker --------------------------------------------------------

/** The sticker's face: the weights a maker's own «shot on» card uses. */
export const STICKER_FONT = "'Montserrat', 'Space Grotesk', sans-serif";

function stickerMetrics(px: number, backing: StickerBacking) {
  const plate = backing === 'plate';
  const padY = plate ? 0.42 * px : 0;
  return { padX: plate ? 0.62 * px : 0, padY, boxH: 0.9 * px + 2 * padY, between: 0.32 * px };
}

function stickerFont(ctx: Ctx2D, weight: number, px: number): void {
  ctx.font = `${weight} ${px}px ${STICKER_FONT}`;
  // Ignored where a canvas has no letter spacing: the sticker is merely a touch tighter.
  if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${(0.02 * px).toFixed(2)}px`;
}

function measureSticker(ctx: Ctx2D, item: StickerItem, px: number) {
  const logoH = 0.86 * px;
  const logoW = item.logo ? logoH * item.logo.ratio : 0;
  // The font and its spacing are the sticker's: the text engine draws after it on this context.
  ctx.save();
  stickerFont(ctx, 600, px);
  const boldW = item.bold ? ctx.measureText(item.bold).width : 0;
  stickerFont(ctx, 300, px);
  const lightW = item.light ? ctx.measureText(item.light).width : 0;
  ctx.restore();
  const gap = 0.3 * px;
  const parts = [logoW, boldW, lightW].filter((w) => w > 0);
  return { w: parts.reduce((s, w) => s + w, 0) + gap * Math.max(0, parts.length - 1), logoW, logoH, boldW, lightW, gap };
}

/** A logo in one ink, kept per size: its shape, none of its colours. */
const tintCache = new WeakMap<object, Map<string, CanvasImageSource>>();
function tintedLogo(logo: StickerLogoSource, w: number, h: number, ink: string): CanvasImageSource {
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  const key = `${ink}|${cw}|${ch}`;
  let byKey = tintCache.get(logo.image as object);
  if (!byKey) tintCache.set(logo.image as object, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
  const c = canvas.getContext('2d') as Ctx2D | null;
  if (!c) return logo.image;
  c.drawImage(logo.image, 0, 0, cw, ch);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = ink;
  c.fillRect(0, 0, cw, ch);
  if (byKey.size > 12) byKey.clear();
  byKey.set(key, canvas);
  return canvas;
}

function drawSticker(ctx: Ctx2D, item: StickerItem, x: number, y: number, px: number, ink: string, backing: StickerBacking, unit: number): void {
  const m = stickerMetrics(px, backing);
  const k = measureSticker(ctx, item, px);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (backing === 'plate') {
    const dark = luminance(ink) > 0.5;
    ctx.fillStyle = dark ? 'rgba(12,14,18,0.48)' : 'rgba(250,248,242,0.86)';
    ctx.beginPath();
    ctx.roundRect(x, y, k.w + 2 * m.padX, m.boxH, 0.32 * px);
    ctx.fill();
  }
  if (backing === 'shadow') {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6 * unit;
    ctx.shadowOffsetY = unit;
  }
  let cx = x + m.padX;
  // The caps sit in the middle of a box 0.9 em tall.
  const baseline = y + m.padY + 0.81 * px;
  if (item.logo) {
    const top = baseline - 0.36 * px - k.logoH / 2;
    const source = item.tint ? tintedLogo(item.logo, k.logoW, k.logoH, ink) : item.logo.image;
    ctx.drawImage(source, cx, top, k.logoW, k.logoH);
    cx += k.logoW + k.gap;
  }
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (item.bold) {
    stickerFont(ctx, 600, px);
    ctx.fillText(item.bold, cx, baseline);
    cx += k.boldW + k.gap;
  }
  if (item.light) {
    stickerFont(ctx, 300, px);
    ctx.fillText(item.light, cx, baseline);
  }
  ctx.restore();
}
