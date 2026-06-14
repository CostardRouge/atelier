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
 * The video's shorter dimension — the stable reference for `sizeFrac`.
 * For landscape (vw > vh) this equals vh; for portrait (vh > vw) this equals
 * vw, so text and arrows stay the same apparent size regardless of orientation.
 */
function refDim(vw: number, vh: number): number {
  return Math.min(vw, vh);
}

/**
 * Measure one text element against `ctx` (font metrics need a real context).
 * Returns null for elements with nothing to show or for non-text kinds
 * (heading-arrow has its own layout path).
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

  const fontPx = Math.max(1, el.sizeFrac * refDim(vw, vh));
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

// ---------------------------------------------------------------------------
// Heading-arrow element
// ---------------------------------------------------------------------------

/**
 * When the compass is enabled, the bounding square must accommodate the ring
 * and the N/E/S/W labels. This factor is applied to the arrow half-size `r` to
 * produce the effective `halfSize` of the whole element.
 *
 * Layout (relative to `r`):
 *   ring edge: r × 2.0   |   letter centre: r × 2.5   |   label edge: r × 2.75
 * → pad to r × 2.9 so the label's cap height doesn't clip.
 */
const COMPASS_FACTOR = 2.9;

interface ArrowLayout {
  /** Center of the element in video pixels. */
  cx: number;
  cy: number;
  /** Arrow chevron half-size. */
  r: number;
  /**
   * Effective bounding half-size: equals `r` when no compass, `r × COMPASS_FACTOR`
   * when the compass ring is shown.
   */
  halfSize: number;
  /** Top-left of the bounding square (for hit-testing / anchor math). */
  x: number;
  y: number;
  w: number;
  h: number;
}

function arrowLayout(el: OverlayElement, vw: number, vh: number): ArrowLayout {
  const r = Math.max(2, el.sizeFrac * refDim(vw, vh) * 0.5);
  const halfSize = el.showCompass ? r * COMPASS_FACTOR : r;
  const w = halfSize * 2;
  const h = halfSize * 2;
  const { x, y } = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h);
  return { cx: x + halfSize, cy: y + halfSize, r, halfSize, x, y, w, h };
}

/**
 * Draw a heading-arrow element.
 *
 * The arrow chevron rotates to `cue.derived.heading` (0 = North = up on screen).
 * When `el.showCompass` is true, a fixed compass ring with dashed cardinal lines
 * and N/E/S/W labels is drawn first in screen space (it never rotates).
 *
 * Rotation formula: canvas 0° = East; heading 0° = North = up on screen,
 * so `canvas_angle = (heading − 90) × π/180`.
 */
function drawArrow(
  ctx: Ctx2D,
  el: OverlayElement,
  cue: Cue | null,
  vw: number,
  vh: number,
): void {
  const lay = arrowLayout(el, vw, vh);
  const { cx, cy, r, halfSize } = lay;
  const heading = cue?.derived?.heading;

  ctx.save();
  ctx.translate(cx, cy);

  // --- axis-aligned background box (before any rotation) ---
  if (el.legibility.mode === 'box') {
    const pad = el.legibility.padFrac * r;
    ctx.fillStyle = el.legibility.color;
    roundRectPath(
      ctx,
      -halfSize - pad,
      -halfSize - pad,
      (halfSize + pad) * 2,
      (halfSize + pad) * 2,
      pad * 0.5,
    );
    ctx.fill();
  }

  // --- compass ring, dashed cardinal lines and N/E/S/W labels ---
  // All drawn in screen space (never rotated) so North is always at the top.
  if (el.showCompass) {
    const ringR = r * 2.0;
    const lineW = Math.max(0.5, r * 0.055);
    const gapR = r * 0.65; // inner clear zone around the arrow

    ctx.save();

    if (el.legibility.mode === 'shadow') {
      ctx.shadowColor = el.legibility.color;
      ctx.shadowBlur = el.legibility.padFrac * r * 0.6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    // Ring outline
    ctx.strokeStyle = el.color;
    ctx.lineWidth = lineW;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // Dashed cardinal lines (N, S, E, W) — from the gap around the arrow to the ring.
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([ringR * 0.09, ringR * 0.07]);
    ctx.beginPath();
    ctx.moveTo(0, -gapR);  ctx.lineTo(0, -ringR);   // N
    ctx.moveTo(0, gapR);   ctx.lineTo(0, ringR);    // S
    ctx.moveTo(gapR, 0);   ctx.lineTo(ringR, 0);    // E
    ctx.moveTo(-gapR, 0);  ctx.lineTo(-ringR, 0);   // W
    ctx.stroke();
    ctx.setLineDash([]);

    // Cardinal letters
    const letterR = ringR + r * 0.5;
    const letterPx = Math.max(6, r * 0.52);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = el.color;
    ctx.font = `bold ${letterPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -letterR);
    ctx.fillText('S', 0, letterR);
    ctx.fillText('E', letterR, 0);
    ctx.fillText('W', -letterR, 0);

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // --- rotate ctx for the directional arrow ---
  if (heading != null) {
    ctx.rotate((heading - 90) * (Math.PI / 180));
  }

  if (el.legibility.mode === 'shadow') {
    ctx.shadowColor = el.legibility.color;
    ctx.shadowBlur = el.legibility.padFrac * r;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else {
    ctx.shadowColor = ZERO_SHADOW;
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = el.color;

  if (heading != null) {
    // Chevron pointing right (East) before rotation.
    // Tip at (+r, 0); concave tail notch at (−r·0.15, 0).
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.4, -r * 0.6);
    ctx.lineTo(-r * 0.15, 0);
    ctx.lineTo(-r * 0.4, r * 0.6);
    ctx.closePath();
    ctx.fill();
  } else {
    // Hovering — no direction: dot confirms the element is present.
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

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
    if (el.kind === 'heading-arrow') {
      drawArrow(ctx, el, cue, videoWidth, videoHeight);
      continue;
    }
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
    if (el.kind === 'heading-arrow') {
      const alay = arrowLayout(el, videoWidth, videoHeight);
      const margin = Math.max(2, alay.r * 0.15);
      boxes.push({
        id: el.id,
        x: alay.x - margin,
        y: alay.y - margin,
        w: alay.w + margin * 2,
        h: alay.h + margin * 2,
      });
      continue;
    }
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
  if (el.kind === 'heading-arrow') {
    const alay = arrowLayout(el, vw, vh);
    const p = anchorPoint(anchor, alay.x, alay.y, alay.w, alay.h);
    return { x: p.x / vw, y: p.y / vh };
  }
  const lay = layoutElement(ctx, el, cue, vw, vh);
  if (!lay) return null;
  const p = anchorPoint(anchor, lay.x, lay.y, lay.w, lay.h);
  return { x: p.x / vw, y: p.y / vh };
}
