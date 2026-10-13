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
}

/** Statistics side by side, each its value over its label. */
export interface StatRow {
  kind: 'row';
  items: { value: string; label: string; odometer?: number }[];
  size: number;
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

export type Block = TextLine | StatRow | StatColumn | CurveBlock;

export interface OverlayLayout {
  spots: Partial<Record<Spot, Block[]>>;
  theme: StyleTheme;
  accent: string;
  /** Every size times this. */
  scale: number;
}

const ANCHOR: Record<Spot, Anchor> = {
  tl: 'top-left',
  tc: 'top-center',
  tr: 'top-right',
  bl: 'top-left',
  bc: 'top-center',
  br: 'top-right',
};

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
 * short side over 1080.
 */
export function paintOverlay(ctx: Ctx2D, layout: OverlayLayout, area: Rect): void {
  const short = Math.min(area.w, area.h);
  const unit = (short / 1080) * layout.scale;
  const margin = 0.045 * short;
  const theme = layout.theme;
  const accent = layout.accent;
  const elements: OverlayElement[] = [];
  const curves: { block: CurveBlock; x: number; y: number; w: number; h: number }[] = [];
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
    return textElement(`o${seq++}`, line.text, anchor, (x - area.x) / area.w, (y - area.y) / area.h, (line.size * unit) / short, over, pinned);
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

  const blockHeight = (b: Block): number => {
    switch (b.kind) {
      case 'text':
        return heightOf(b) * (1 + (b.gapAfter ?? 0));
      case 'row':
        return (heightOf(b) + heightOf({ size: b.size * 0.42 })) * 1.08;
      case 'column':
        return b.items.length * heightOf(b) * 1.04;
      case 'curve':
        return b.size * unit + 44 * unit;
    }
  };

  for (const spot of Object.keys(layout.spots) as Spot[]) {
    const blocks = layout.spots[spot] ?? [];
    if (!blocks.length) continue;
    const total = blocks.reduce((h, b) => h + blockHeight(b), 0);
    const bottom = spot[0] === 'b';
    const align = spot[1] === 'l' ? 'left' : spot[1] === 'c' ? 'center' : 'right';
    const anchor = ANCHOR[spot];
    const ax = align === 'left' ? area.x + margin : align === 'center' ? area.x + area.w / 2 : area.x + area.w - margin;
    let y = bottom ? area.y + area.h - margin - total : area.y + margin;
    const colW = Math.min(area.w - 2 * margin, Math.max(300 * unit, area.w * 0.28));

    for (const b of blocks) {
      const h = blockHeight(b);
      if (b.kind === 'text') {
        elements.push(lineElement(b, anchor, ax, y));
      } else if (b.kind === 'row') {
        const valueH = heightOf(b);
        const gap = b.size * unit * 0.9;
        const widths = b.items.map((it) => Math.max(widthOf(it.value, b.size, false), widthOf(it.label, b.size * 0.42, true)));
        const rowW = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, b.items.length - 1);
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
      } else {
        const w = colW;
        const x = align === 'left' ? ax : align === 'center' ? ax - w / 2 : ax - w;
        curves.push({ block: b, x, y: y + 6 * unit, w, h: b.size * unit });
      }
      y += h;
    }
  }

  for (const c of curves) drawCurve(ctx, c.block, c.x, c.y, c.w, c.h, unit, accent, theme);

  if (elements.length) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, area.x, area.y);
    // The engine lays elements out in its own frame: the area, at the origin.
    const local = elements.map((el) => el);
    drawOverlays(ctx, local, null, area.w, area.h, { theme });
    ctx.restore();
  }
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
