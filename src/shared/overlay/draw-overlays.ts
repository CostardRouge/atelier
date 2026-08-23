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
import { formatHeading, motionAt } from '../telemetry/motion';
import type { TimeShift } from '../telemetry/time-format';
import { MISSING, renderElementText } from './field-format';
import { batteryLevel } from './battery';
import { tapeFadeAlpha, tapeTicks } from './heading-tape';
import { smoothHeading } from '../telemetry/heading-smooth';
import type { Anchor, LabelPlacement, OverlayElement } from './overlay-types';
import { isHidden, transformAt, type Transform } from './animation';
import { tipAngle } from './rotate-device';
import { findScene, resolveScenes, resolveWindow, type Scene } from './scenes';
import {
  halolight,
  resolveElementStyle,
  warmDrift,
  withAlpha,
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
  /**
   * The project's capture-time correction, applied to every clock/date/
   * timestamp element at once (see telemetry/time-format.ts for why this is a
   * shift and not a timezone).
   */
  timeShift?: TimeShift | null;
  /**
   * The whole cue list. The heading instruments need it, not just the cue at
   * the playhead: their easing averages a window of readings and bridges the
   * gaps where course-over-ground is unavailable (see heading-smooth.ts).
   */
  cues?: readonly Cue[];
  /**
   * The scenes of the project — the intro and anything else that lends a group
   * of elements one window, a scrim and the power to hold the rest back.
   */
  scenes?: readonly Scene[];
  /**
   * Media time of the FIRST EXPORTED FRAME, i.e. the clip's in point. Windows
   * and animations are counted from it, not from the media's zero: trimming
   * two seconds off the head must not eat the intro that plays over them.
   */
  originSeconds?: number;
  /**
   * Editor-only. This element is drawn even outside its window, ghosted, so a
   * title that lives at 0–3 s can still be selected and dragged with the
   * playhead at 0:42. Never set on an export path.
   */
  ghostId?: string | null;
}

/**
 * Alpha of the element being drawn — an animation's fade, and the scene solo's
 * hold-back.
 *
 * It is module state rather than a parameter because an element's drawing runs
 * through a dozen helpers that each *assign* `globalAlpha` (the tape's per-tick
 * fade, the compass ring, the glow's grain). A wrapper alpha would be stomped
 * by the first of them, and the element would fade in pieces; every absolute
 * assignment therefore goes through `alpha()`. Set and cleared around each
 * element by `drawOverlays`, which is the only writer.
 */
let elementAlpha = 1;

function alpha(a: number): number {
  return a * elementAlpha;
}

/** How visible an out-of-window element is while it is selected in the editor. */
const GHOST_ALPHA = 0.35;

/**
 * The bearing a heading instrument should draw, and how strongly.
 *
 * Falls back to the cue's own raw reading when no cue list was supplied (the
 * legacy overlay page), so nothing regresses where smoothing isn't wired.
 */
function headingFor(
  el: OverlayElement,
  cue: Cue | null,
  opts?: DrawOptions,
): { heading: number | null; alpha: number } {
  const early = el.earlyValues !== false;
  const raw = motionAt(cue, early).heading ?? null;
  const cues = opts?.cues;
  if (!cues || cues.length === 0) return { heading: raw, alpha: 1 };

  const gap = el.headingGap ?? 'dim';
  const hold = gap === 'hide' ? 0 : (el.headingHoldSeconds ?? 2);
  const out = smoothHeading(
    cues,
    opts?.timeSeconds ?? 0,
    el.headingSmoothing ?? 0.6,
    hold,
    early,
  );
  if (out.heading == null) return { heading: null, alpha: 1 };
  // Live data always draws at full strength; only a stale bearing fades, and
  // only in 'dim' mode. 'hold' shows it plainly until the window runs out.
  if (out.confidence <= 0) return { heading: null, alpha: 1 };
  const alpha = gap === 'dim' ? Math.max(0.25, out.confidence) : 1;
  return { heading: out.heading, alpha };
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
  timeShift?: TimeShift | null,
): Layout | null {
  const raw = renderElementText(el, cue, timeShift);
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
  ctx.globalAlpha = alpha(0.45);
  ctx.beginPath();
  ctx.arc(0, 0, ringR, 0, Math.PI * 2);
  ctx.stroke();

  // Dashed cardinal lines — from the gap around the arrow to the ring edge.
  ctx.globalAlpha = alpha(0.35);
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
  ctx.globalAlpha = alpha(0.92);
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
  opts?: DrawOptions,
): void {
  const st = resolveElementStyle(el, theme ?? null);
  const lay = arrowLayout(el, vw, vh);
  const { cx, cy, r, halfSize } = lay;
  const { heading: eased, alpha: headingAlpha } = headingFor(el, cue, opts);
  const heading = eased ?? undefined;
  const isRelative = el.compassMode === 'relative';

  ctx.save();
  ctx.translate(cx, cy);

  // --- axis-aligned background box (never rotated) ---
  if (st.legibility.mode === 'box') {
    paintLegibilityBox(ctx, st, -halfSize, -halfSize, halfSize * 2, halfSize * 2, r);
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
    ctx.globalAlpha = alpha(0.45);
  } else {
    // A held (stale) bearing draws faded rather than vanishing — the abrupt
    // cut is what the maintainer wanted gone.
    ctx.globalAlpha = alpha(headingAlpha);
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

// ---------------------------------------------------------------------------
// Heading tape (compass ribbon)
// ---------------------------------------------------------------------------

interface TapeLayout {
  /** Centre of the ribbon (where the sight sits), in video pixels. */
  cx: number;
  cy: number;
  halfW: number;
  fontPx: number;
  /** Major tick height; minors are 55% of it. */
  tickH: number;
  /** Bounding box, caption included. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Offset from the box top to the ribbon's centre line. */
  ribbonDy: number;
}

function tapeLayout(
  el: OverlayElement,
  st: ResolvedStyle,
  vw: number,
  vh: number,
): TapeLayout {
  const fontPx = Math.max(4, st.sizeFrac * refDim(vw, vh));
  const halfW = Math.max(fontPx, ((el.tapeWidthFrac ?? 0.5) * vw) / 2);
  const tickH = Math.max(2, fontPx * (el.tapeTickScale ?? 1));
  const place = el.tapeLabel ?? 'above';
  // Ribbon band: ticks hang below the rule, labels sit under them.
  const bandH = tickH + fontPx * 1.35;
  // A caption above/below adds a line; left/right widen instead.
  const capH = place === 'above' || place === 'below' ? fontPx * 1.5 : 0;
  const capW = place === 'left' || place === 'right' ? fontPx * 6 : 0;
  const w = halfW * 2 + capW;
  const h = bandH + capH;

  const { x, y } = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h);
  const ribbonTop = place === 'above' ? y + capH : y;
  const cx = place === 'left' ? x + capW + halfW : x + halfW;
  return {
    cx,
    cy: ribbonTop,
    halfW,
    fontPx,
    tickH,
    x,
    y,
    w,
    h,
    ribbonDy: ribbonTop - y,
  };
}

/**
 * The heading tape: a slice of the compass scale sliding under a fixed sight.
 *
 * Everything is drawn per-tick with its own alpha rather than through one
 * masked layer — a canvas alpha mask would need an offscreen buffer per frame,
 * and the export renders at full resolution. Fading each mark individually
 * costs nothing and reads the same.
 */
function drawHeadingTape(
  ctx: Ctx2D,
  el: OverlayElement,
  cue: Cue | null,
  vw: number,
  vh: number,
  theme?: StyleTheme | null,
  opts?: DrawOptions,
): void {
  const st = resolveElementStyle(el, theme ?? null);
  const lay = tapeLayout(el, st, vw, vh);
  const { heading: eased, alpha: headingAlpha } = headingFor(el, cue, opts);
  const heading = eased ?? undefined;
  const { cx, cy, halfW, fontPx, tickH } = lay;
  const fade = el.tapeFadeFrac ?? 0.22;
  const lineW = Math.max(0.6, fontPx * 0.09);

  ctx.save();
  ctx.globalAlpha = alpha(Math.max(0, Math.min(1, el.tapeOpacity ?? 1)));

  if (st.legibility.mode === 'shadow') {
    ctx.shadowColor = st.legibility.color;
    ctx.shadowBlur = Math.max(1, st.legibility.padFrac * fontPx);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = fontPx * 0.05;
  } else if (st.glow) {
    const [wr, wg, wb] = warmDrift(st.color, st.glowWarmth);
    ctx.shadowColor = `rgba(${wr},${wg},${wb},${st.glow.haloAlpha})`;
    ctx.shadowBlur = Math.max(1, st.glow.haloRadiusFrac * fontPx * 3);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // The rule the ticks stand on: one gradient, transparent at both ends.
  if ((el.tapeRule ?? true) && typeof ctx.createLinearGradient === 'function') {
    const grad = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
    const stop = Math.max(0, Math.min(0.49, fade));
    grad.addColorStop(0, withAlpha(st.color, 0));
    grad.addColorStop(stop, withAlpha(st.color, 0.75));
    grad.addColorStop(1 - stop, withAlpha(st.color, 0.75));
    grad.addColorStop(1, withAlpha(st.color, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(cx - halfW, cy);
    ctx.lineTo(cx + halfW, cy);
    ctx.stroke();
  }

  // No heading (hovering, or a clip with no telemetry): the furniture stays,
  // the scale does not — a tape frozen on an invented bearing would be a lie.
  if (heading == null) {
    ctx.globalAlpha *= 0.5;
    ctx.fillStyle = st.color;
    ctx.font = fontString(st, fontPx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('—', cx, cy + tickH * 0.35);
  } else {
    const ticks = tapeTicks(
      heading,
      el.tapeSpanDeg ?? 90,
      el.tapeMajorStep ?? 30,
      el.tapeMinorStep ?? 10,
      el.tapeCardinals ?? true,
    );
    ctx.font = fontString(st, fontPx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tick of ticks) {
      const tickAlpha = tapeFadeAlpha(tick.t, fade);
      if (tickAlpha <= 0.01) continue;
      const tx = cx + tick.t * halfW;
      const len = tick.major ? tickH : tickH * 0.55;
      ctx.globalAlpha = alpha(
        tickAlpha * Math.max(0, Math.min(1, el.tapeOpacity ?? 1)) * headingAlpha,
      );
      ctx.strokeStyle = st.color;
      ctx.lineWidth = tick.major ? lineW : lineW * 0.7;
      ctx.beginPath();
      ctx.moveTo(tx, cy);
      ctx.lineTo(tx, cy + len);
      ctx.stroke();
      if (tick.label) {
        ctx.fillStyle = st.color;
        ctx.fillText(tick.label, tx, cy + tickH + fontPx * 0.15);
      }
    }
  }

  // The sight — its own colour, so it never dissolves into the scale.
  ctx.globalAlpha = alpha(Math.max(0, Math.min(1, el.tapeOpacity ?? 1)));
  const reticle = el.tapeReticle ?? 'both';
  const rc = el.tapeReticleColor ?? st.color;
  if (reticle !== 'none') {
    ctx.strokeStyle = rc;
    ctx.fillStyle = rc;
    ctx.lineWidth = lineW * 1.4;
    if (reticle === 'line' || reticle === 'both') {
      ctx.beginPath();
      ctx.moveTo(cx, cy - tickH * 0.55);
      ctx.lineTo(cx, cy + tickH * 1.05);
      ctx.stroke();
    }
    if (reticle === 'triangle' || reticle === 'both') {
      const s = tickH * 0.42;
      ctx.beginPath();
      ctx.moveTo(cx, cy - lineW * 0.5);
      ctx.lineTo(cx - s, cy - s - lineW * 0.5);
      ctx.lineTo(cx + s, cy - s - lineW * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Caption: the same reading the tape shows, in words.
  const place = el.tapeLabel ?? 'above';
  if (place !== 'none') {
    const caption = formatHeading(heading) ?? `${el.label ?? 'HDG'} ${MISSING}`;
    const text = st.uppercase ? caption.toUpperCase() : caption;
    ctx.fillStyle = st.color;
    ctx.font = fontString(st, fontPx);
    if (place === 'above') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, cx, cy - tickH * 0.75);
    } else if (place === 'below') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(text, cx, cy + tickH + fontPx * 1.5);
    } else if (place === 'left') {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx - halfW - fontPx * 0.5, cy + tickH * 0.4);
    } else {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx + halfW + fontPx * 0.5, cy + tickH * 0.4);
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Battery gauge
// ---------------------------------------------------------------------------

interface BatteryLayout {
  /** Top-left of the cell itself (the caption sits outside it). */
  cellX: number;
  cellY: number;
  cellW: number;
  cellH: number;
  fontPx: number;
  /** Bounding box, caption included. */
  x: number;
  y: number;
  w: number;
  h: number;
}

function batteryLayout(
  el: OverlayElement,
  st: ResolvedStyle,
  vw: number,
  vh: number,
): BatteryLayout {
  const fontPx = Math.max(4, st.sizeFrac * refDim(vw, vh));
  const cellH = fontPx * 1.15;
  const cellW = cellH * Math.max(1.2, el.batteryAspect ?? 2.1);
  // The nub on the positive end reads as a battery at any size.
  const nub = cellW * 0.07;
  const place = el.batteryShowPercent === false ? 'none' : (el.batteryLabel ?? 'right');
  const capW = place === 'left' || place === 'right' ? fontPx * 2.8 : 0;
  const capH = place === 'above' || place === 'below' ? fontPx * 1.35 : 0;

  const w = cellW + nub + capW;
  const h = cellH + capH;
  const { x, y } = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h);
  return {
    cellX: place === 'left' ? x + capW : x,
    cellY: place === 'above' ? y + capH : y,
    cellW,
    cellH,
    fontPx,
    x,
    y,
    w,
    h,
  };
}

/**
 * The battery gauge: a cell that fills with the level, turning to the alarm
 * colour under the low threshold. With no level at all it draws the empty cell
 * and a “—” — the same honesty as a missing telemetry field (see battery.ts:
 * the DJI video sidecar carries no state of charge).
 */
function drawBattery(
  ctx: Ctx2D,
  el: OverlayElement,
  cue: Cue | null,
  vw: number,
  vh: number,
  theme?: StyleTheme | null,
): void {
  const st = resolveElementStyle(el, theme ?? null);
  const lay = batteryLayout(el, st, vw, vh);
  const { cellX, cellY, cellW, cellH, fontPx } = lay;
  const level = batteryLevel(el, cue);
  const low = el.batteryLowPercent ?? 20;
  const fill =
    level != null && level <= low ? (el.batteryLowColor ?? '#e2402a') : st.color;
  const lineW = Math.max(0.6, fontPx * 0.08);

  ctx.save();
  if (st.legibility.mode === 'box') {
    paintLegibilityBox(ctx, st, lay.x, lay.y, lay.w, lay.h, fontPx);
  } else if (st.legibility.mode === 'shadow') {
    ctx.shadowColor = st.legibility.color;
    ctx.shadowBlur = Math.max(1, st.legibility.padFrac * fontPx);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = fontPx * 0.05;
  } else if (st.glow) {
    const [wr, wg, wb] = warmDrift(fill, st.glowWarmth);
    ctx.shadowColor = `rgba(${wr},${wg},${wb},${st.glow.haloAlpha})`;
    ctx.shadowBlur = Math.max(1, st.glow.haloRadiusFrac * fontPx * 3);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  // Shell + nub
  ctx.strokeStyle = st.color;
  ctx.lineWidth = lineW;
  roundRectPath(ctx, cellX, cellY, cellW, cellH, cellH * 0.22);
  ctx.stroke();
  const nubW = cellW * 0.07;
  const nubH = cellH * 0.42;
  ctx.fillStyle = st.color;
  roundRectPath(
    ctx,
    cellX + cellW + lineW * 0.5,
    cellY + (cellH - nubH) / 2,
    nubW,
    nubH,
    nubW * 0.4,
  );
  ctx.fill();

  // Fill
  const inset = lineW * 1.8;
  if (level != null && level > 0) {
    const innerW = cellW - inset * 2;
    ctx.fillStyle = fill;
    roundRectPath(
      ctx,
      cellX + inset,
      cellY + inset,
      Math.max(lineW, (innerW * level) / 100),
      cellH - inset * 2,
      (cellH - inset * 2) * 0.18,
    );
    ctx.fill();
  }

  // Caption
  const place = el.batteryShowPercent === false ? 'none' : (el.batteryLabel ?? 'right');
  if (place !== 'none') {
    const text = level == null ? MISSING : `${Math.round(level)}%`;
    ctx.fillStyle = level != null && level <= low ? fill : st.color;
    ctx.font = fontString(st, fontPx);
    if (place === 'right') {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cellX + cellW + nubW + fontPx * 0.45, cellY + cellH / 2);
    } else if (place === 'left') {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cellX - fontPx * 0.35, cellY + cellH / 2);
    } else if (place === 'above') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(text, cellX + cellW / 2, cellY - fontPx * 0.2);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(text, cellX + cellW / 2, cellY + cellH + fontPx * 0.2);
    }
  }

  ctx.restore();
}

/**
 * Frame-corner brackets: four L-shaped marks inset from the frame edges — the
 * viewfinder furniture of a HUD. Spans the whole frame, so it ignores the
 * anchor/position: `sizeFrac` is the arm length, `cornerInset` the distance
 * from the edges, both fractions of the shorter side.
 */
function drawFrameCorners(
  ctx: Ctx2D,
  el: OverlayElement,
  vw: number,
  vh: number,
  st: ResolvedStyle,
): void {
  const ref = refDim(vw, vh);
  const arm = Math.max(2, st.sizeFrac * ref);
  const inset = Math.max(0, (el.cornerInset ?? 0.03) * ref);
  const lw = Math.max(1, arm * 0.08);

  ctx.save();
  ctx.strokeStyle = st.color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  if (st.glow) {
    const [wr, wg, wb] = warmDrift(st.color, st.glowWarmth);
    ctx.shadowColor = `rgba(${wr},${wg},${wb},${st.glow.haloAlpha})`;
    ctx.shadowBlur = Math.max(1, st.glow.haloRadiusFrac * ref * 0.6);
  } else if (st.legibility.mode === 'shadow') {
    ctx.shadowColor = st.legibility.color;
    ctx.shadowBlur = st.legibility.padFrac * arm * 0.5;
  }

  const l = inset;
  const t = inset;
  const r = vw - inset;
  const b = vh - inset;
  ctx.beginPath();
  // Top-left
  ctx.moveTo(l, t + arm); ctx.lineTo(l, t); ctx.lineTo(l + arm, t);
  // Top-right
  ctx.moveTo(r - arm, t); ctx.lineTo(r, t); ctx.lineTo(r, t + arm);
  // Bottom-right
  ctx.moveTo(r, b - arm); ctx.lineTo(r, b); ctx.lineTo(r - arm, b);
  // Bottom-left
  ctx.moveTo(l + arm, b); ctx.lineTo(l, b); ctx.lineTo(l, b - arm);
  ctx.stroke();
  ctx.restore();
}

/** Draw a rounded rectangle path (roundRect where available, else manual). */
/**
 * The `box` legibility panel: one filled (optionally outlined) rounded rect
 * behind an element's content box. Every kind that offers `box` goes through
 * here so the radius and the outline behave identically on all of them —
 * before this, four call sites each hard-coded `pad * 0.5` and none could
 * stroke.
 *
 * `x/y/w/h` are the CONTENT box; the padding is added here. `unitPx` is the
 * element's font size (or its equivalent for a shape), which every fraction in
 * `LegibilityStyle` is relative to.
 */
function paintLegibilityBox(
  ctx: Ctx2D,
  st: ResolvedStyle,
  x: number,
  y: number,
  w: number,
  h: number,
  unitPx: number,
): void {
  const leg = st.legibility;
  const pad = leg.padFrac * unitPx;
  ctx.save();
  roundRectPath(
    ctx,
    x - pad,
    y - pad,
    w + pad * 2,
    h + pad * 2,
    pad * (leg.radiusFrac ?? 0.5),
  );
  ctx.fillStyle = leg.color;
  ctx.fill();
  const borderW = (leg.borderWidthFrac ?? 0) * unitPx;
  if (leg.borderColor && borderW > 0) {
    ctx.strokeStyle = leg.borderColor;
    ctx.lineWidth = borderW;
    ctx.stroke();
  }
  ctx.restore();
}

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
 * A scratch canvas the grain is composed in, reused across elements and frames
 * so a full-resolution export doesn't allocate one per readout per frame. It
 * only ever grows; callers draw the sub-rect they asked for.
 */
interface Scratch {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: Ctx2D;
  w: number;
  h: number;
}

/**
 * Two scratch canvases the grain is composed in — the noise field and the mask
 * cut out of it — reused across elements and frames so a full-resolution
 * export doesn't allocate a pair per readout per frame. They only ever grow;
 * callers draw the sub-rect they asked for.
 */
const scratches: Record<'grain' | 'mask', Scratch | null> = { grain: null, mask: null };

/** Refuse to build a grain buffer bigger than this (a runaway glow radius). */
const MAX_SCRATCH = 4096;

function getScratch(key: 'grain' | 'mask', w: number, h: number): Scratch | null {
  if (w > MAX_SCRATCH || h > MAX_SCRATCH) return null;
  const held = scratches[key];
  if (held && held.w >= w && held.h >= h) return held;
  const nw = Math.min(MAX_SCRATCH, Math.max(w, held?.w ?? 0));
  const nh = Math.min(MAX_SCRATCH, Math.max(h, held?.h ?? 0));
  const canvas =
    typeof document !== 'undefined'
      ? document.createElement('canvas')
      : typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(nw, nh)
        : null;
  if (!canvas) return null;
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) return null;
  const made: Scratch = { canvas, ctx, w: nw, h: nh };
  scratches[key] = made;
  return made;
}

/**
 * One element's grain mask (blurred white text), kept across frames.
 *
 * The mask depends only on the glowing text's content, font and glow radius
 * — never on `timeSeconds` — so redrawing it every frame throws away two
 * shadow-blurred `fillText` calls (the single most expensive step in the
 * glow) on a bitmap that is almost always identical to the previous frame's.
 * Keyed by element id, not by content, so a size-preserving text change
 * (e.g. a digit ticking over) reuses the same backing canvas.
 */
interface MaskCacheEntry {
  key: string;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  w: number;
  h: number;
}

const maskCache = new Map<string, MaskCacheEntry>();

/** Defensive backstop against unbounded growth (elements created and never reused). */
const MAX_MASK_CACHE = 256;

function getMaskFor(
  elementId: string,
  lay: Layout,
  glow: GlowLayers,
  w: number,
  h: number,
  bx: number,
  by: number,
): HTMLCanvasElement | OffscreenCanvas | null {
  const key = `${lay.text} ${lay.font} ${lay.st.letterSpacingEm} ${glow.bleedRadiusFrac} ${bx.toFixed(2)},${by.toFixed(2)}`;
  const cached = maskCache.get(elementId);
  if (cached && cached.key === key && cached.w === w && cached.h === h) {
    return cached.canvas;
  }

  // Render into the shared, grow-only scratch first (steps 1's old home) —
  // this is the expensive part, and it only runs on an actual cache miss.
  const scratch = getScratch('mask', w, h);
  if (!scratch) return null;
  const mctx = scratch.ctx;
  mctx.save();
  mctx.globalCompositeOperation = 'source-over';
  mctx.globalAlpha = 1;
  mctx.clearRect(0, 0, w, h);
  mctx.font = lay.font;
  mctx.textBaseline = 'alphabetic';
  mctx.textAlign = 'left';
  setLetterSpacing(mctx, lay.st.letterSpacingEm, lay.fontPx);
  mctx.fillStyle = '#ffffff';
  mctx.shadowColor = 'rgba(255,255,255,1)';
  mctx.shadowBlur = Math.max(1, glow.bleedRadiusFrac * lay.fontPx);
  mctx.shadowOffsetX = 0;
  mctx.shadowOffsetY = 0;
  mctx.fillText(lay.text, bx, by);
  mctx.fillText(lay.text, bx, by);
  setLetterSpacing(mctx, 0, lay.fontPx);
  mctx.restore();

  // Snapshot into a dedicated, element-owned canvas: the shared scratch is
  // overwritten by the next glowing element in the same paint pass, so it
  // cannot double as the cache's storage.
  if (maskCache.size > MAX_MASK_CACHE) maskCache.clear();
  let entry = cached;
  if (!entry || entry.w !== w || entry.h !== h) {
    const canvas =
      typeof document !== 'undefined'
        ? document.createElement('canvas')
        : typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : null;
    if (!canvas) return null;
    canvas.width = w;
    canvas.height = h;
    entry = { key, canvas, w, h };
  } else {
    entry.key = key;
  }
  const ectx = entry.canvas.getContext('2d') as Ctx2D | null;
  if (!ectx) return null;
  ectx.clearRect(0, 0, w, h);
  ectx.drawImage(scratch.canvas, 0, 0, w, h, 0, 0, w, h);
  maskCache.set(elementId, entry);
  return entry.canvas;
}

/**
 * Grain over one glow — the fourth halation layer.
 *
 * It is masked by **the glow's own shape**, not by a bounding box. Painting a
 * clipped rectangle of `overlay` noise is what used to draw a visible lighter
 * square around every glowing readout: the noise stopped dead at the clip
 * edge, and the brighter the glow the larger and more obvious the patch.
 *
 * So the grain is composed in a scratch buffer and cut down with
 * `destination-in` against the same blurred text the bleed layer paints (see
 * `getMaskFor`, cached across frames). The result carries the glow's soft
 * falloff as its alpha: grain is strongest on the letters, thins out through
 * the halation, and reaches zero exactly where the glow does — no edge to see.
 *
 * The mask is built in its OWN buffer first. Drawing shadowed text straight
 * into a `destination-in` context loses the shadow — measured in Chromium:
 * ~2.5k faint pixels survive instead of the ~17k the halation covers — which
 * would erase the grain almost entirely. Two steps, one image composite.
 */
function drawShapedGrain(
  ctx: Ctx2D,
  lay: Layout,
  glow: GlowLayers,
  timeSeconds: number,
  elementId: string,
): void {
  const tile = getGrainTile();
  if (!tile || glow.grainAlpha <= 0) return;

  const reach = glow.bleedRadiusFrac * lay.fontPx + lay.fontPx * 0.3;
  const x = Math.floor(lay.x - reach);
  const y = Math.floor(lay.y - reach);
  const w = Math.ceil(lay.w + reach * 2);
  const h = Math.ceil(lay.h + reach * 2);
  if (w <= 0 || h <= 0) return;

  // No buffer available (no DOM, no OffscreenCanvas, or an absurd radius):
  // skip the grain rather than fall back to painting a square.
  const buf = getScratch('grain', w, h);
  if (!buf) return;

  const bx = lay.x - x;
  const by = lay.y - y + lay.ascent;
  const mask = getMaskFor(elementId, lay, glow, w, h, bx, by);
  if (!mask) return;

  // 2 — the noise field, offset deterministically from the media time so the
  //     preview and the export grain identically at the same frame.
  const bctx = buf.ctx;
  bctx.save();
  bctx.globalCompositeOperation = 'source-over';
  bctx.globalAlpha = 1;
  bctx.clearRect(0, 0, w, h);
  const step = Math.floor(timeSeconds * 10);
  const ox = (step * 53) % 128;
  const oy = (step * 97) % 128;
  for (let ty = -oy; ty < h; ty += 128) {
    for (let tx = -ox; tx < w; tx += 128) {
      bctx.drawImage(tile, tx, ty);
    }
  }

  // 3 — cut the field down to the glow's shape.
  bctx.globalCompositeOperation = 'destination-in';
  bctx.drawImage(mask, 0, 0, w, h, 0, 0, w, h);
  bctx.restore();

  // 4 — onto the frame, 'overlay' so it bites the bright halo and the dark
  //     ground alike instead of washing grey over both.
  ctx.save();
  ctx.globalAlpha = alpha(glow.grainAlpha);
  ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(buf.canvas, 0, 0, w, h, x, y, w, h);
  ctx.restore();
}

/**
 * The four-layer glow behind/around a text run (see title-styles.ts): wide
 * warm bleed, tight bright halo, softened core, then grain masked by the glow
 * itself. Layers 1–2 are extra fills of the same text carrying only a shadow;
 * the third fill is the letter body.
 */
function drawGlowedText(
  ctx: Ctx2D,
  lay: Layout,
  glow: GlowLayers,
  timeSeconds: number,
  elementId: string,
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

  // 4 — grain, shaped by the glow rather than by a bounding box.
  drawShapedGrain(ctx, lay, glow, timeSeconds, elementId);
}

// ---------------------------------------------------------------------------
// Rotate-device prompt
// ---------------------------------------------------------------------------

interface RotateLayout {
  /** Bounding box of the whole element, caption included. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Centre of the square the phone tips inside. */
  cx: number;
  cy: number;
  /** The square's side — the box the phone tips inside and the arc runs in. */
  side: number;
  phoneW: number;
  phoneH: number;
  /** Turn-arrow radius and stroke weight, sized independently of the phone. */
  arcRadius: number;
  arcWeight: number;
  fontPx: number;
  caption: string;
  place: LabelPlacement;
  gap: number;
}

/**
 * Default fraction of the box `side` the phone's height uses, and the arc's
 * radius. Chosen so neither touches the other AT ANY POINT of the turn: the
 * phone's farthest reach from the box centre is its half-diagonal, which does
 * not change as it rotates (only which direction it points does) — so keeping
 * that half-diagonal comfortably inside the arc's inner edge is enough,
 * whatever `localSeconds` lands on.
 */
const DEFAULT_PHONE_SCALE = 0.66;
const DEFAULT_ARC_SCALE = 0.44;

/**
 * The pictogram's geometry. The phone tips a quarter turn, so the box that
 * holds it is a SQUARE of its height: sizing the box to the upright phone
 * would make the element jump around its anchor mid-turn, and its grab box
 * disagree with what is on screen half the time.
 */
function rotateLayout(
  ctx: Ctx2D,
  el: OverlayElement,
  st: ResolvedStyle,
  vw: number,
  vh: number,
): RotateLayout {
  // `sizeFrac` sizes the SQUARE the phone tips inside; `rotatePhoneScale` and
  // `rotateArcScale` size the phone and the turn arrow independently within
  // it, both as a fraction of `side` — that independence is the point: making
  // the arrow bigger must not also inflate the phone it arcs around, and vice
  // versa.
  const side = Math.max(8, st.sizeFrac * refDim(vw, vh));
  const phoneH = side * (el.rotatePhoneScale ?? DEFAULT_PHONE_SCALE);
  const phoneW = phoneH * 0.52;
  const arcRadius = side * (el.rotateArcScale ?? DEFAULT_ARC_SCALE);
  const arcWeight = Math.max(0.8, side * 0.028);
  const fontPx = Math.max(4, side * 0.15);
  const caption = st.uppercase ? (el.text ?? '').toUpperCase() : (el.text ?? '');
  const place: LabelPlacement = caption.trim() ? (el.rotateLabel ?? 'below') : 'none';
  const gap = side * 0.08;

  let capW = 0;
  if (place === 'left' || place === 'right') {
    ctx.save();
    ctx.font = fontString(st, fontPx);
    capW = ctx.measureText(caption).width + gap;
    ctx.restore();
  }
  const capH = place === 'above' || place === 'below' ? fontPx * 1.35 + gap : 0;

  const w = side + capW;
  const h = side + capH;
  const { x, y } = anchorOrigin(el.anchor, el.x * vw, el.y * vh, w, h);
  const sqX = place === 'left' ? x + capW : x;
  const sqY = place === 'above' ? y + capH : y;
  return {
    x,
    y,
    w,
    h,
    cx: sqX + side / 2,
    cy: sqY + side / 2,
    side,
    phoneW,
    phoneH,
    arcRadius,
    arcWeight,
    fontPx,
    caption,
    place,
    gap,
  };
}

/**
 * The arc-and-arrowhead that says "turn", drawn in the STATIC frame: the phone
 * moves under it, the instruction does not move with it. A still frame (a
 * thumbnail, a frame grab) must read as an instruction too, which is why the
 * arrow exists at all rather than the motion carrying everything.
 */
function drawTurnArrow(ctx: Ctx2D, r: number, weight: number, cw: boolean): void {
  const from = (-160 * Math.PI) / 180;
  const to = (-20 * Math.PI) / 180;
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, 0, r, from, to);
  ctx.stroke();

  // Head at the end the motion runs towards, along the arc's tangent there.
  const a = cw ? to : from;
  const dir = cw ? 1 : -1;
  const hx = r * Math.cos(a);
  const hy = r * Math.sin(a);
  const tx = -Math.sin(a) * dir;
  const ty = Math.cos(a) * dir;
  const size = weight * 3;
  ctx.beginPath();
  ctx.moveTo(hx + tx * size, hy + ty * size);
  ctx.lineTo(hx - ty * size * 0.6 - tx * size * 0.2, hy + tx * size * 0.6 - ty * size * 0.2);
  ctx.lineTo(hx + ty * size * 0.6 - tx * size * 0.2, hy - tx * size * 0.6 - ty * size * 0.2);
  ctx.closePath();
  ctx.fill();
}

function drawRotateDevice(
  ctx: Ctx2D,
  el: OverlayElement,
  vw: number,
  vh: number,
  theme: StyleTheme | null | undefined,
  localSeconds: number,
): void {
  const st = resolveElementStyle(el, theme ?? null);
  const lay = rotateLayout(ctx, el, st, vw, vh);
  const stroke = Math.max(0.8, lay.phoneH * 0.035);

  ctx.save();
  if (st.legibility.mode === 'box') {
    paintLegibilityBox(ctx, st, lay.x, lay.y, lay.w, lay.h, lay.fontPx);
  } else if (st.legibility.mode === 'shadow') {
    ctx.shadowColor = st.legibility.color;
    ctx.shadowBlur = Math.max(1, st.legibility.padFrac * lay.fontPx);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = lay.fontPx * 0.05;
  } else if (st.glow) {
    const [wr, wg, wb] = warmDrift(st.color, st.glowWarmth);
    ctx.shadowColor = `rgba(${wr},${wg},${wb},${st.glow.haloAlpha})`;
    ctx.shadowBlur = Math.max(1, st.glow.haloRadiusFrac * lay.fontPx * 3);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  ctx.strokeStyle = st.color;
  ctx.fillStyle = st.color;

  // The turn arrow, around the phone but not turning with it.
  ctx.save();
  ctx.translate(lay.cx, lay.cy);
  ctx.globalAlpha = alpha(0.9);
  drawTurnArrow(ctx, lay.arcRadius, lay.arcWeight, (el.rotateDirection ?? 'cw') === 'cw');
  ctx.restore();

  // The phone itself.
  ctx.save();
  ctx.translate(lay.cx, lay.cy);
  ctx.rotate(
    tipAngle(
      localSeconds,
      el.rotateCycleSeconds ?? 1.8,
      el.rotateDirection ?? 'cw',
      el.rotateReturn ?? true,
    ),
  );
  const pw = lay.phoneW;
  const ph = lay.phoneH;
  ctx.fillStyle = withAlpha(st.color, 0.14);
  roundRectPath(ctx, -pw / 2, -ph / 2, pw, ph, pw * 0.2);
  ctx.fill();
  ctx.strokeStyle = st.color;
  ctx.lineWidth = stroke;
  roundRectPath(ctx, -pw / 2, -ph / 2, pw, ph, pw * 0.2);
  ctx.stroke();
  // Earpiece and home bar: two marks are enough to read "phone" and they tell
  // the viewer which way up it is.
  ctx.fillStyle = st.color;
  roundRectPath(ctx, -pw * 0.13, -ph * 0.42, pw * 0.26, stroke, stroke * 0.5);
  ctx.fill();
  ctx.globalAlpha = alpha(0.75);
  roundRectPath(ctx, -pw * 0.18, ph * 0.38, pw * 0.36, stroke, stroke * 0.5);
  ctx.fill();
  ctx.restore();

  // The caption.
  if (lay.place !== 'none') {
    ctx.globalAlpha = alpha(1);
    ctx.fillStyle = st.color;
    ctx.font = fontString(st, lay.fontPx);
    setLetterSpacing(ctx, st.letterSpacingEm, lay.fontPx);
    if (lay.place === 'above' || lay.place === 'below') {
      ctx.textAlign = 'center';
      ctx.textBaseline = lay.place === 'above' ? 'bottom' : 'top';
      const ty =
        lay.place === 'above' ? lay.cy - lay.side / 2 - lay.gap : lay.cy + lay.side / 2 + lay.gap;
      ctx.fillText(lay.caption, lay.cx, ty);
    } else {
      ctx.textAlign = lay.place === 'left' ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      const tx =
        lay.place === 'left' ? lay.cx - lay.side / 2 - lay.gap : lay.cx + lay.side / 2 + lay.gap;
      ctx.fillText(lay.caption, tx, lay.cy);
    }
    setLetterSpacing(ctx, 0, lay.fontPx);
  }
  ctx.restore();
}

/** Paint one text-bearing element (fields, labels, titles). */
function drawTextElement(
  ctx: Ctx2D,
  lay: Layout,
  timeSeconds: number,
  reveal: number,
  revealSteps: boolean,
  elementId: string,
): void {
  const st = lay.st;
  ctx.font = lay.font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const pad = st.legibility.padFrac * lay.fontPx;

  if (reveal < 1) {
    // Cut the element down to the revealed share, from its left edge. The clip
    // is generous vertically so a glow or a legibility box is not sliced along
    // the way — only the reveal's own edge should show.
    const cutW = revealWidth(ctx, lay, reveal, revealSteps);
    const slack = lay.fontPx * 2 + pad * 2;
    ctx.beginPath();
    ctx.rect(lay.x - slack, lay.y - slack, cutW + slack, lay.h + slack * 2);
    ctx.clip();
  }

  if (st.legibility.mode === 'box') {
    paintLegibilityBox(ctx, st, lay.x, lay.y, lay.w, lay.h, lay.fontPx);
  }

  if (st.glow) {
    drawGlowedText(ctx, lay, st.glow, timeSeconds, elementId);
    return;
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

/**
 * Where to cut a partly-revealed text. A typewriter stops on whole characters
 * (it is typing, not wiping), which needs the substring measured against the
 * same font and letter-spacing the paint uses; a wipe cuts anywhere.
 */
function revealWidth(ctx: Ctx2D, lay: Layout, reveal: number, steps: boolean): number {
  if (!steps) return lay.w * reveal;
  const chars = [...lay.text];
  const shown = Math.round(chars.length * reveal);
  if (shown >= chars.length) return lay.w;
  if (shown <= 0) return 0;
  ctx.save();
  ctx.font = lay.font;
  setLetterSpacing(ctx, lay.st.letterSpacingEm, lay.fontPx);
  const w = ctx.measureText(chars.slice(0, shown).join('')).width;
  setLetterSpacing(ctx, 0, lay.fontPx);
  ctx.restore();
  return w;
}

/**
 * The scrim: a scene's veil over the picture, under every element. Painted
 * before the deck so a HUD left visible by a non-solo scene stays readable on
 * top of it rather than being dimmed with the footage.
 */
function drawScrim(
  ctx: Ctx2D,
  scrim: { color: string; opacity: number },
  vw: number,
  vh: number,
): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, scrim.opacity));
  ctx.fillStyle = scrim.color;
  ctx.fillRect(0, 0, vw, vh);
  ctx.restore();
}

/**
 * Apply an element's animation to `ctx`. Scaling happens around the element's
 * ANCHOR point, not its box centre: a title anchored bottom-left grows from
 * that corner and stays pinned there, which is what placing it there meant.
 */
function applyTransform(
  ctx: Ctx2D,
  el: OverlayElement,
  tf: Transform,
  vw: number,
  vh: number,
): void {
  if (tf.dx !== 0 || tf.dy !== 0) {
    const ref = refDim(vw, vh);
    ctx.translate(tf.dx * ref, tf.dy * ref);
  }
  if (tf.scale !== 1) {
    const ox = el.x * vw;
    const oy = el.y * vh;
    ctx.translate(ox, oy);
    ctx.scale(tf.scale, tf.scale);
    ctx.translate(-ox, -oy);
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
  const elapsed = elapsedAt(opts);
  const layer = resolveScenes(opts?.scenes, elapsed);
  if (layer.scrim) drawScrim(ctx, layer.scrim, videoWidth, videoHeight);

  for (const el of elements) {
    if (!el.visible) continue;
    const scene = findScene(opts?.scenes, el.sceneId);
    const win = resolveWindow(el, scene);
    let tf = transformAt(el.animation, win, elapsed);
    if (!scene && layer.outsideAlpha < 1) {
      tf = { ...tf, alpha: tf.alpha * layer.outsideAlpha };
    }
    if (isHidden(tf)) {
      // Out of its window: normally not drawn at all — unless the editor is
      // pointing at it, in which case a ghost keeps it selectable and
      // draggable instead of stranding it at a playhead it does not live at.
      if (opts?.ghostId !== el.id) continue;
      tf = { alpha: GHOST_ALPHA, dx: 0, dy: 0, scale: 1, reveal: 1, revealSteps: false };
    }

    ctx.save();
    elementAlpha = tf.alpha;
    ctx.globalAlpha = tf.alpha;
    applyTransform(ctx, el, tf, videoWidth, videoHeight);

    if (el.kind === 'heading-arrow') {
      drawArrow(ctx, el, cue, videoWidth, videoHeight, theme, opts);
    } else if (el.kind === 'heading-tape') {
      drawHeadingTape(ctx, el, cue, videoWidth, videoHeight, theme, opts);
    } else if (el.kind === 'battery') {
      drawBattery(ctx, el, cue, videoWidth, videoHeight, theme);
    } else if (el.kind === 'frame-corners') {
      drawFrameCorners(ctx, el, videoWidth, videoHeight, resolveElementStyle(el, theme));
    } else if (el.kind === 'rotate-device') {
      // Its own cycle runs from the moment the element appears, so the phone
      // always starts upright rather than mid-tip.
      drawRotateDevice(ctx, el, videoWidth, videoHeight, theme, elapsed - (win?.start ?? 0));
    } else {
      const lay = layoutElement(
        ctx,
        el,
        cue,
        videoWidth,
        videoHeight,
        theme,
        opts?.timeShift,
      );
      if (lay) drawTextElement(ctx, lay, timeSeconds, tf.reveal, tf.revealSteps, el.id);
    }

    elementAlpha = 1;
    ctx.restore();
  }
}

/** Seconds since the first exported frame — what windows are counted from. */
function elapsedAt(opts?: DrawOptions): number {
  return Math.max(0, (opts?.timeSeconds ?? 0) - (opts?.originSeconds ?? 0));
}

/**
 * Whether an element is on screen at this instant — the same answer
 * `drawOverlays` acts on, so hit boxes never outlive what is painted.
 */
function isOnScreen(
  el: OverlayElement,
  opts: DrawOptions | undefined,
  elapsed: number,
  outsideAlpha: number,
): boolean {
  if (opts?.ghostId === el.id) return true;
  const scene = findScene(opts?.scenes, el.sceneId);
  // Held back by a solo scene counts as off screen: during an intro that hides
  // the HUD, a click on the picture must not land on an invisible readout.
  if (!scene && outsideAlpha <= 0) return false;
  return !isHidden(transformAt(el.animation, resolveWindow(el, scene), elapsed));
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
  const elapsed = elapsedAt(opts);
  const { outsideAlpha } = resolveScenes(opts?.scenes, elapsed);
  const boxes: ElementBox[] = [];
  for (const el of elements) {
    if (!el.visible) continue;
    // Frame corners span the whole frame: a hit box would swallow every click,
    // so they are never draggable — select them from the element list.
    if (el.kind === 'frame-corners') continue;
    // An element that is not on screen has no box: clicking where a title will
    // be in two seconds must not grab it. The ghosted selection is the one
    // exception, and it is exactly why it is drawn.
    if (!isOnScreen(el, opts, elapsed, outsideAlpha)) continue;
    // The box is deliberately measured WITHOUT the animation's transform: a
    // title that is mid-slide would otherwise squirm away from the pointer.
    if (el.kind === 'rotate-device') {
      const st = resolveElementStyle(el, theme);
      const lay = rotateLayout(ctx, el, st, videoWidth, videoHeight);
      const margin = Math.max(2, lay.fontPx * 0.3);
      boxes.push({
        id: el.id,
        x: lay.x - margin,
        y: lay.y - margin,
        w: lay.w + margin * 2,
        h: lay.h + margin * 2,
      });
      continue;
    }
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
    if (el.kind === 'heading-tape' || el.kind === 'battery') {
      const st = resolveElementStyle(el, theme);
      const lay =
        el.kind === 'heading-tape'
          ? tapeLayout(el, st, videoWidth, videoHeight)
          : batteryLayout(el, st, videoWidth, videoHeight);
      const margin = Math.max(2, st.sizeFrac * refDim(videoWidth, videoHeight) * 0.3);
      boxes.push({
        id: el.id,
        x: lay.x - margin,
        y: lay.y - margin,
        w: lay.w + margin * 2,
        h: lay.h + margin * 2,
      });
      continue;
    }
    const lay = layoutElement(ctx, el, cue, videoWidth, videoHeight, theme, opts?.timeShift);
    if (!lay) continue;
    // The grab box must cover everything painted: legibility padding, and the
    // glow's bleed when the element carries one (a glow clipped out of its
    // own hit-box would be undraggable at the edges).
    const border =
      lay.st.legibility.mode === 'box'
        ? (lay.st.legibility.borderWidthFrac ?? 0) * lay.fontPx * 0.5
        : 0;
    const margin = Math.max(
      lay.st.legibility.padFrac * lay.fontPx + border,
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
  timeShift?: TimeShift | null,
): { x: number; y: number } | null {
  if (el.kind === 'frame-corners') return null;
  if (el.kind === 'heading-arrow') {
    const alay = arrowLayout(el, vw, vh);
    const p = anchorPoint(anchor, alay.x, alay.y, alay.w, alay.h);
    return { x: p.x / vw, y: p.y / vh };
  }
  if (el.kind === 'heading-tape' || el.kind === 'battery') {
    const st = resolveElementStyle(el, theme ?? null);
    const lay =
      el.kind === 'heading-tape'
        ? tapeLayout(el, st, vw, vh)
        : batteryLayout(el, st, vw, vh);
    const p = anchorPoint(anchor, lay.x, lay.y, lay.w, lay.h);
    return { x: p.x / vw, y: p.y / vh };
  }
  if (el.kind === 'rotate-device') {
    const lay = rotateLayout(ctx, el, resolveElementStyle(el, theme ?? null), vw, vh);
    const p = anchorPoint(anchor, lay.x, lay.y, lay.w, lay.h);
    return { x: p.x / vw, y: p.y / vh };
  }
  const lay = layoutElement(ctx, el, cue, vw, vh, theme ?? null, timeShift);
  if (!lay) return null;
  const p = anchorPoint(anchor, lay.x, lay.y, lay.w, lay.h);
  return { x: p.x / vw, y: p.y / vh };
}
