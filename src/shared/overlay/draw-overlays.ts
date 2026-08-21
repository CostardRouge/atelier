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
import {
  halolight,
  resolveElementStyle,
  warmDrift,
  type GlowLayers,
  type ResolvedStyle,
  type StyleTheme,
} from './title-styles';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Optional render context: the project theme and the media time (grain). */
export interface DrawOptions {
  theme?: StyleTheme | null;
  /** Current media time in seconds — phases the animated grain so preview and
   * export stay frame-identical. */
  timeSeconds?: number;
}

/** Generic fallback appended to each family so missing glyphs degrade sanely. */
function genericFallback(family: string): string {
  if (
    family === 'JetBrains Mono' ||
    family === 'Courier New' ||
    family === 'VT323'
  ) {
    return 'monospace';
  }
  if (family === 'Instrument Serif' || family === 'Georgia') return 'serif';
  return 'sans-serif';
}

/** Build a CSS `font` shorthand for a resolved style at a given pixel size. */
function fontString(st: ResolvedStyle, fontPx: number): string {
  const style = st.italic ? 'italic ' : '';
  return `${style}${st.weight} ${fontPx}px '${st.fontFamily}', ${genericFallback(
    st.fontFamily,
  )}`;
}

/**
 * Canvas letter-spacing (Chromium 99+/Safari 17+). Set before BOTH measure and
 * draw so the box matches the paint; silently absent elsewhere (spacing is a
 * refinement, never load-bearing).
 */
function setLetterSpacing(ctx: Ctx2D, em: number, fontPx: number): void {
  if ('letterSpacing' in ctx) {
    (ctx as { letterSpacing: string }).letterSpacing = `${em * fontPx}px`;
  }
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
  /** The element's appearance after theme/override resolution. */
  st: ResolvedStyle;
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
  theme?: StyleTheme | null,
): Layout | null {
  const raw = renderElementText(el, cue);
  if (raw === '') return null;
  const st = resolveElementStyle(el, theme ?? null);
  const text = st.uppercase ? raw.toUpperCase() : raw;

  const fontPx = Math.max(1, st.sizeFrac * refDim(vw, vh));
  const font = fontString(st, fontPx);
  ctx.font = font;
  setLetterSpacing(ctx, st.letterSpacingEm, fontPx);
  const m = ctx.measureText(text);
  setLetterSpacing(ctx, 0, fontPx);
  const w = m.width;
  const ascent = m.actualBoundingBoxAscent ?? fontPx * 0.8;
  const descent = m.actualBoundingBoxDescent ?? fontPx * 0.2;
  const h = ascent + descent;

  const { x, y } = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h);
  return { text, font, fontPx, x, y, w, h, ascent, st };
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
 * Draw the compass ring, dashed cardinal lines and N/E/S/W labels.
 * Call this inside a `ctx.save()/restore()` block with any desired rotation
 * already applied: in absolute mode the ctx is unrotated (N fixed at screen
 * top); in relative (track-up) mode the ctx is pre-rotated by `−heading°` so
 * the heading direction floats to the top.
 */
function drawCompassDecoration(ctx: Ctx2D, r: number, st: ResolvedStyle): void {
  const ringR = r * 2.0;
  const lineW = Math.max(0.5, r * 0.055);
  const gapR = r * 0.65;

  if (st.glow) {
    const [wr, wg, wb] = warmDrift(st.color, st.glowWarmth);
    ctx.shadowColor = `rgba(${wr},${wg},${wb},${st.glow.haloAlpha})`;
    ctx.shadowBlur = Math.max(1, st.glow.haloRadiusFrac * r * 3);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else if (st.legibility.mode === 'shadow') {
    ctx.shadowColor = st.legibility.color;
    ctx.shadowBlur = st.legibility.padFrac * r * 0.6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // Ring outline
  ctx.strokeStyle = st.color;
  ctx.lineWidth = lineW;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.arc(0, 0, ringR, 0, Math.PI * 2);
  ctx.stroke();

  // Dashed cardinal lines — from the gap around the arrow to the ring edge.
  ctx.globalAlpha = 0.35;
  ctx.setLineDash([ringR * 0.09, ringR * 0.07]);
  ctx.beginPath();
  ctx.moveTo(0, -gapR); ctx.lineTo(0, -ringR);  // N
  ctx.moveTo(0,  gapR); ctx.lineTo(0,  ringR);  // S
  ctx.moveTo( gapR, 0); ctx.lineTo( ringR, 0);  // E
  ctx.moveTo(-gapR, 0); ctx.lineTo(-ringR, 0);  // W
  ctx.stroke();
  ctx.setLineDash([]);

  // Cardinal letters
  const letterR = ringR + r * 0.5;
  const letterPx = Math.max(6, r * 0.52);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = st.color;
  ctx.font = `bold ${letterPx}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -letterR);
  ctx.fillText('S', 0,  letterR);
  ctx.fillText('E',  letterR, 0);
  ctx.fillText('W', -letterR, 0);

  ctx.globalAlpha = 1;
}

/**
 * Draw a heading-arrow element.
 *
 * Two modes (controlled by `el.compassMode`):
 *
 *  • **absolute** (default / north-up): the compass ring is fixed — N is always
 *    at the top of the screen. The arrow rotates to show the current heading.
 *
 *  • **relative** (track-up): the arrow is always pinned pointing UP (forward
 *    direction). The compass ring rotates by `−heading°` so the heading
 *    direction rises to the top, just like a "track-up" map on a car GPS.
 *
 * When no heading is available (hovering, GPS noise floor):
 *  - absolute mode: draws a dot instead of the arrow.
 *  - relative mode: draws the arrow pointing up with a slightly reduced opacity
 *    to signal "no data, last known direction".
 */
function drawArrow(
  ctx: Ctx2D,
  el: OverlayElement,
  cue: Cue | null,
  vw: number,
  vh: number,
  theme?: StyleTheme | null,
): void {
  const st = resolveElementStyle(el, theme ?? null);
  const lay = arrowLayout(el, vw, vh);
  const { cx, cy, r, halfSize } = lay;
  const heading = cue?.derived?.heading;
  const isRelative = el.compassMode === 'relative';

  ctx.save();
  ctx.translate(cx, cy);

  // --- axis-aligned background box (never rotated) ---
  if (st.legibility.mode === 'box') {
    const pad = st.legibility.padFrac * r;
    ctx.fillStyle = st.legibility.color;
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

  // --- compass decoration ---
  if (el.showCompass) {
    ctx.save();
    if (isRelative && heading != null) {
      // Track-up: rotate the compass so the current heading floats to the top.
      // heading 0° (N) → rotate(0) → N at top ✓
      // heading 90° (E) → rotate(−90°) → E at top ✓
      ctx.rotate(-heading * (Math.PI / 180));
    }
    // Absolute mode: no rotation — N always at screen top.
    drawCompassDecoration(ctx, r, st);
    ctx.restore();
  }

  // --- arrow rotation ---
  if (isRelative) {
    // Arrow always points up regardless of heading.
    // The chevron is drawn pointing right by default, so −90° = up.
    ctx.rotate(-Math.PI / 2);
  } else if (heading != null) {
    // North-up: rotate the arrow to the heading direction.
    // canvas 0° = East; heading 0° = North = up → offset −90°.
    ctx.rotate((heading - 90) * (Math.PI / 180));
  }

  if (st.glow) {
    // The glow's halo layer, adapted to a filled shape: one warm shadow pass.
    const [wr, wg, wb] = warmDrift(st.color, st.glowWarmth);
    ctx.shadowColor = `rgba(${wr},${wg},${wb},${st.glow.haloAlpha})`;
    ctx.shadowBlur = Math.max(1, (st.glow.haloRadiusFrac + st.glow.bleedRadiusFrac * 0.4) * r * 3);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else if (st.legibility.mode === 'shadow') {
    ctx.shadowColor = st.legibility.color;
    ctx.shadowBlur = st.legibility.padFrac * r;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else {
    ctx.shadowColor = ZERO_SHADOW;
    ctx.shadowBlur = 0;
  }

  // In relative mode with no heading data: draw the arrow at reduced opacity
  // (direction is unknown but "forward = up" convention still holds visually).
  if (isRelative && heading == null) {
    ctx.globalAlpha = 0.45;
  }

  ctx.fillStyle = st.color;

  if (heading != null || isRelative) {
    // Chevron pointing right (East) before rotation.
    // Tip at (+r, 0); concave tail notch at (−r × 0.15, 0).
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.4, -r * 0.6);
    ctx.lineTo(-r * 0.15, 0);
    ctx.lineTo(-r * 0.4,  r * 0.6);
    ctx.closePath();
    ctx.fill();
  } else {
    // Absolute mode, hovering — dot confirms the element is present.
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

// ---------------------------------------------------------------------------
// Film grain (the glow's fourth layer)
// ---------------------------------------------------------------------------

/** Deterministic 128² monochrome noise tile, built once (any time, any run). */
let grainTile: HTMLCanvasElement | OffscreenCanvas | null = null;

function getGrainTile(): HTMLCanvasElement | OffscreenCanvas | null {
  if (grainTile) return grainTile;
  const size = 128;
  const canvas =
    typeof document !== 'undefined'
      ? document.createElement('canvas')
      : typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(size, size)
        : null;
  if (!canvas) return null;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  // Tiny LCG so preview and export produce the identical tile.
  let seed = 987654321;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed % 256;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTile = canvas;
  return canvas;
}

/**
 * Grain over one glow region: the noise tile, offset deterministically from
 * the media time (~10 steps/s), composited 'overlay' so it bites both the
 * bright halo and the dark ground — never a plain grey wash.
 */
function drawGrain(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
  timeSeconds: number,
): void {
  const tile = getGrainTile();
  if (!tile || alpha <= 0 || w <= 0 || h <= 0) return;
  const step = Math.floor(timeSeconds * 10);
  // Deterministic pseudo-random offsets per step.
  const ox = (step * 53) % 128;
  const oy = (step * 97) % 128;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'overlay';
  for (let ty = y - oy - 128; ty < y + h; ty += 128) {
    for (let tx = x - ox - 128; tx < x + w; tx += 128) {
      ctx.drawImage(tile, tx, ty);
    }
  }
  ctx.restore();
}

/**
 * The four-layer glow behind/around a text run (see title-styles.ts): wide
 * warm bleed, tight bright halo, softened core, then grain over the whole
 * region. Layers 1–2 are extra fills of the same text carrying only a shadow;
 * the final fill is the letter body itself.
 */
function drawGlowedText(
  ctx: Ctx2D,
  lay: Layout,
  glow: GlowLayers,
  timeSeconds: number,
): void {
  const { st, fontPx } = lay;
  const baselineY = lay.y + lay.ascent;
  const [wr, wg, wb] = warmDrift(st.color, st.glowWarmth);

  setLetterSpacing(ctx, st.letterSpacingEm, fontPx);

  // 1 — wide bleed, warm-drifted, drawn twice so the veil has body.
  if (glow.bleedRadiusFrac > 0 && glow.bleedAlpha > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(${wr},${wg},${wb},${glow.bleedAlpha})`;
    ctx.shadowBlur = glow.bleedRadiusFrac * fontPx;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = st.color;
    ctx.fillText(lay.text, lay.x, baselineY);
    ctx.fillText(lay.text, lay.x, baselineY);
    ctx.restore();
  }

  // 2 — tight halo, brightened ink.
  if (glow.haloRadiusFrac > 0 && glow.haloAlpha > 0) {
    ctx.save();
    ctx.shadowColor = halolight(st.color, glow.haloAlpha);
    ctx.shadowBlur = Math.max(1, glow.haloRadiusFrac * fontPx);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = st.color;
    ctx.fillText(lay.text, lay.x, baselineY);
    ctx.restore();
  }

  // 3 — the letter body, slightly softened where ctx.filter exists.
  ctx.save();
  const coreBlur = glow.coreBlurFrac * fontPx;
  if (coreBlur >= 0.2 && 'filter' in ctx) {
    (ctx as { filter: string }).filter = `blur(${coreBlur.toFixed(2)}px)`;
  }
  ctx.shadowColor = ZERO_SHADOW;
  ctx.shadowBlur = 0;
  ctx.fillStyle = st.color;
  ctx.fillText(lay.text, lay.x, baselineY);
  ctx.restore();

  setLetterSpacing(ctx, 0, fontPx);

  // 4 — grain over the whole glow region.
  if (glow.grainAlpha > 0) {
    const reach = glow.bleedRadiusFrac * fontPx + fontPx * 0.2;
    drawGrain(
      ctx,
      lay.x - reach,
      lay.y - reach,
      lay.w + reach * 2,
      lay.h + reach * 2,
      glow.grainAlpha,
      timeSeconds,
    );
  }
}

/** Paint all visible elements onto `ctx`. */
export function drawOverlays(
  ctx: Ctx2D,
  elements: OverlayElement[],
  cue: Cue | null,
  videoWidth: number,
  videoHeight: number,
  opts?: DrawOptions,
): void {
  const theme = opts?.theme ?? null;
  const timeSeconds = opts?.timeSeconds ?? 0;
  for (const el of elements) {
    if (!el.visible) continue;
    if (el.kind === 'heading-arrow') {
      drawArrow(ctx, el, cue, videoWidth, videoHeight, theme);
      continue;
    }
    const lay = layoutElement(ctx, el, cue, videoWidth, videoHeight, theme);
    if (!lay) continue;
    const st = lay.st;

    ctx.font = lay.font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    const pad = st.legibility.padFrac * lay.fontPx;
    if (st.legibility.mode === 'box') {
      ctx.save();
      ctx.fillStyle = st.legibility.color;
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

    if (lay.st.glow) {
      drawGlowedText(ctx, lay, lay.st.glow, timeSeconds);
      continue;
    }

    ctx.save();
    setLetterSpacing(ctx, st.letterSpacingEm, lay.fontPx);
    if (st.legibility.mode === 'shadow') {
      ctx.shadowColor = st.legibility.color;
      ctx.shadowBlur = Math.max(1, st.legibility.padFrac * lay.fontPx);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = lay.fontPx * 0.05;
    } else {
      ctx.shadowColor = ZERO_SHADOW;
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = st.color;
    ctx.fillText(lay.text, lay.x, lay.y + lay.ascent);
    setLetterSpacing(ctx, 0, lay.fontPx);
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
  opts?: DrawOptions,
): ElementBox[] {
  const theme = opts?.theme ?? null;
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
    const lay = layoutElement(ctx, el, cue, videoWidth, videoHeight, theme);
    if (!lay) continue;
    // The grab box must cover everything painted: legibility padding, and the
    // glow's bleed when the element carries one (a glow clipped out of its
    // own hit-box would be undraggable at the edges).
    const margin = Math.max(
      lay.st.legibility.padFrac * lay.fontPx,
      lay.fontPx * 0.2,
      lay.st.glow ? lay.st.glow.bleedRadiusFrac * lay.fontPx * 0.5 : 0,
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
  theme?: StyleTheme | null,
): { x: number; y: number } | null {
  if (el.kind === 'heading-arrow') {
    const alay = arrowLayout(el, vw, vh);
    const p = anchorPoint(anchor, alay.x, alay.y, alay.w, alay.h);
    return { x: p.x / vw, y: p.y / vh };
  }
  const lay = layoutElement(ctx, el, cue, vw, vh, theme ?? null);
  if (!lay) return null;
  const p = anchorPoint(anchor, lay.x, lay.y, lay.w, lay.h);
  return { x: p.x / vw, y: p.y / vh };
}
