/**
 * The single canvas renderer shared by the editor preview AND the export, so
 * the two can never drift. Coordinates are normalized and font size is a
 * fraction of video height, so passing the preview's (scaled) or the export's
 * (full-resolution) dimensions yields an identical layout.
 *
 * `drawOverlays` paints; `measureOverlays` returns the same pixel boxes for
 * hit-testing the drag. Both go through one `layoutElement` helper, so what you
 * grab is exactly what's drawn. `anchorOrigin` and `hitTest` are pure geometry
 * (no canvas), kept separate so they're unit-testable.
 */

import type { Cue } from '../telemetry/srt-parser';
import { renderElementText } from './field-format';
import type { Anchor, OverlayElement } from './overlay-types';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Generic fallback appended to each family so missing glyphs degrade sanely. */
function genericFallback(family: string): string {
  if (family === 'JetBrains Mono' || family === 'Courier New') return 'monospace';
  if (family === 'Instrument Serif' || family === 'Georgia') return 'serif';
  return 'sans-serif';
}

/** Build a CSS `font` shorthand for an element at a given pixel size. */
function fontString(el: OverlayElement, fontPx: number): string {
  const style = el.italic ? 'italic ' : '';
  return `${style}${el.weight} ${fontPx}px '${el.fontFamily}', ${genericFallback(
    el.fontFamily,
  )}`;
}

/** Split an anchor into its vertical and horizontal components. */
function splitAnchor(anchor: Anchor): {
  v: 'top' | 'center' | 'bottom';
  h: 'left' | 'center' | 'right';
} {
  if (anchor === 'center') return { v: 'center', h: 'center' };
  const [v, h] = anchor.split('-') as [
    'top' | 'center' | 'bottom',
    'left' | 'center' | 'right',
  ];
  return { v, h };
}

/**
 * Top-left draw origin for a box of size `w`×`h` whose anchor point sits at
 * (`ax`, `ay`). Pure — the basis for both drawing and hit-testing.
 */
export function anchorOrigin(
  anchor: Anchor,
  ax: number,
  ay: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const { v, h: hor } = splitAnchor(anchor);
  let x = ax;
  if (hor === 'center') x = ax - w / 2;
  else if (hor === 'right') x = ax - w;
  let y = ay;
  if (v === 'center') y = ay - h / 2;
  else if (v === 'bottom') y = ay - h;
  return { x, y };
}

/**
 * Where the anchor point sits for a box whose top-left is (`x`, `y`) — the exact
 * inverse of {@link anchorOrigin}. Lets us re-anchor an element *in place*:
 * switch which corner is the handle without the box jumping on screen.
 */
export function anchorPoint(
  anchor: Anchor,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const { v, h: hor } = splitAnchor(anchor);
  let ax = x;
  if (hor === 'center') ax = x + w / 2;
  else if (hor === 'right') ax = x + w;
  let ay = y;
  if (v === 'center') ay = y + h / 2;
  else if (v === 'bottom') ay = y + h;
  return { x: ax, y: ay };
}

interface Layout {
  text: string;
  font: string;
  fontPx: number;
  /** Top-left of the text's tight box, in video pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Baseline offset from the box top (for textBaseline:'alphabetic'). */
  ascent: number;
}

/**
 * Measure one element against `ctx` (font metrics need a real context). Returns
 * null for elements with nothing to show, so they're neither drawn nor
 * hit-tested.
 */
function layoutElement(
  ctx: Ctx2D,
  el: OverlayElement,
  cue: Cue | null,
  vw: number,
  vh: number,
): Layout | null {
  const text = renderElementText(el, cue);
  if (text === '') return null;

  const fontPx = Math.max(1, el.sizeFrac * vh);
  const font = fontString(el, fontPx);
  ctx.font = font;
  const m = ctx.measureText(text);
  const w = m.width;
  const ascent = m.actualBoundingBoxAscent ?? fontPx * 0.8;
  const descent = m.actualBoundingBoxDescent ?? fontPx * 0.2;
  const h = ascent + descent;

  const { x, y } = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h);
  return { text, font, fontPx, x, y, w, h, ascent };
}

const ZERO_SHADOW = 'rgba(0,0,0,0)';

/** Draw a rounded rectangle path (roundRect where available, else manual). */
function roundRectPath(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Paint all visible elements onto `ctx`. */
export function drawOverlays(
  ctx: Ctx2D,
  elements: OverlayElement[],
  cue: Cue | null,
  videoWidth: number,
  videoHeight: number,
): void {
  for (const el of elements) {
    if (!el.visible) continue;
    const lay = layoutElement(ctx, el, cue, videoWidth, videoHeight);
    if (!lay) continue;

    ctx.font = lay.font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    const pad = el.legibility.padFrac * lay.fontPx;
    if (el.legibility.mode === 'box') {
      ctx.save();
      ctx.fillStyle = el.legibility.color;
      roundRectPath(
        ctx,
        lay.x - pad,
        lay.y - pad,
        lay.w + pad * 2,
        lay.h + pad * 2,
        pad * 0.5,
      );
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (el.legibility.mode === 'shadow') {
      ctx.shadowColor = el.legibility.color;
      ctx.shadowBlur = Math.max(1, el.legibility.padFrac * lay.fontPx);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = lay.fontPx * 0.05;
    } else {
      ctx.shadowColor = ZERO_SHADOW;
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = el.color;
    ctx.fillText(lay.text, lay.x, lay.y + lay.ascent);
    ctx.restore();
  }
}

/** Geometry of one element in video-pixel space — used for hit-testing. */
export interface ElementBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pixel bounding boxes for every visible element, in draw order (so the last
 * box is the topmost). Boxes include the legibility padding plus a small hit
 * margin, so thin text is still easy to grab.
 */
export function measureOverlays(
  ctx: Ctx2D,
  elements: OverlayElement[],
  cue: Cue | null,
  videoWidth: number,
  videoHeight: number,
): ElementBox[] {
  const boxes: ElementBox[] = [];
  for (const el of elements) {
    if (!el.visible) continue;
    const lay = layoutElement(ctx, el, cue, videoWidth, videoHeight);
    if (!lay) continue;
    const margin = Math.max(
      el.legibility.padFrac * lay.fontPx,
      lay.fontPx * 0.2,
    );
    boxes.push({
      id: el.id,
      x: lay.x - margin,
      y: lay.y - margin,
      w: lay.w + margin * 2,
      h: lay.h + margin * 2,
    });
  }
  return boxes;
}

/**
 * Topmost element id whose box contains (`px`, `py`), or null. Boxes are in
 * draw order, so the search runs back-to-front (last drawn wins).
 */
export function hitTest(boxes: ElementBox[], px: number, py: number): string | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
      return b.id;
    }
  }
  return null;
}

/** Find a single element's box (for drawing the selection outline). */
export function boxForId(boxes: ElementBox[], id: string): ElementBox | null {
  return boxes.find((b) => b.id === id) ?? null;
}

/**
 * Re-anchor an element to `anchor` while keeping its rendered box exactly where
 * it is: measures the current box, then returns the normalized (x, y) the new
 * anchor needs so the visible position doesn't change. Returns null when the
 * element has nothing to measure (then just swap the anchor — it isn't drawn).
 */
export function reanchorInPlace(
  ctx: Ctx2D,
  el: OverlayElement,
  cue: Cue | null,
  vw: number,
  vh: number,
  anchor: Anchor,
): { x: number; y: number } | null {
  const lay = layoutElement(ctx, el, cue, vw, vh);
  if (!lay) return null;
  const p = anchorPoint(anchor, lay.x, lay.y, lay.w, lay.h);
  return { x: p.x / vw, y: p.y / vh };
}
